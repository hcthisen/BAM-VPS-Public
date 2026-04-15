import { randomUUID } from "node:crypto";

import { marked } from "marked";
import { enforceFinalWordsBeforeFaq, isFaqHeading, orderFinalWordsBeforeFaq } from "@/lib/content/article-structure";
import { DEFAULT_IMAGE_DENSITY_PCT, normalizeImageDensityPct, selectHeadingsForImageDensity } from "@/lib/content/image-density";
import {
  buildKeywordTargetSequence,
  formatKeywordTarget,
  normalizeKeywordTarget,
  type KeywordTarget,
} from "@/lib/keywords/settings";
import { insertArticleImages, type ArticleImage } from "@/lib/content/images";
import { selectKeywordCandidatesForSlots, type KeywordSelectionCandidate } from "@/lib/content/keyword-rotation";
import { query, withTransaction } from "@/lib/db";
import { enqueueJob, type QueueName } from "@/lib/jobs";
import { dataForSeoPost, scrapePageContent } from "@/lib/providers/dataforseo";
import { generateArticle, generateImages, generateJson } from "@/lib/providers/openai";
import { parseFeed } from "@/lib/providers/rss";
import { downloadAsset, uploadAsset } from "@/lib/providers/storage";
import { createWpPost, findWpPostBySlug, uploadWpMedia, updateWpPost, type WordPressCredentials } from "@/lib/providers/wordpress";
import { readWordPressApplicationPassword } from "@/lib/site-credentials";
import { type CredentialTestState, type SiteSetupState, type SiteStepState } from "@/lib/sites/lifecycle";
import { completeJob, markJobRunning } from "@/lib/services/job-runs";
import { slugify } from "@/lib/services/slug";
import { importExistingPostKeywords } from "@/lib/services/keyword-import";
import { syncWordPressEntities } from "@/lib/services/wordpress-sync";

/**
 * Base writing style guide — the foundation all site-specific tone guides build on.
 * Used as reference during tone guide generation AND injected into every content prompt.
 */
const BASE_WRITING_STYLE = `BASE WRITING STYLE (apply these rules to all reader-facing content):

1. Reading Level: Write at a 5th-8th grade reading level. Use everyday, familiar words. When a technical term is needed, include a brief plain-language explanation in parentheses.

2. Tone & Voice: Write as if having an unscripted conversation with a close friend. Use contractions throughout (don't, it's, we're). Include subtle personal asides or reflective questions ("Have you ever noticed...?"). Allow small imperfections, a brief self-correction, a fragmented sentence, these contribute to an authentic human feel.

3. Sentence Structure: Vary lengths deliberately. Mix short punchy sentences (5-8 words) with medium (10-18 words) and occasionally longer reflective ones (up to 25 words). Start sentences with "But," "And," or "So" when it enhances flow. Use occasional fragments or one-word sentences ("Really." or "Hmm.") to mimic natural pauses.

4. Paragraphing: Short paragraphs (2-4 sentences each), each focused on one idea. Use one-sentence paragraphs sparingly for emphasis. Allow brief digressions that mimic natural conversation, but guide back with clear transitions.

5. Punctuation: Use only basic punctuation (periods, commas, simple hyphens). No em dashes or double hyphens. Limit exclamation marks to one per paragraph. Break long comma-heavy sentences into two sentences.

6. Natural Imperfections: Do not over-edit. You may include ONE brief self-correction or aside in the entire article (e.g., "Well, actually..." or "Wait, let me clarify"). Do NOT overdo this, one instance max. No fake fillers like "um" or "you know".

7. Sensory Details: Ground descriptions with vivid sensory details ("the soft murmur of rain on rooftops"). Pair abstract ideas with everyday analogies and step-by-step instructions.

8. Emotional Nuance: Weave subtle personal anecdotes or reflective questions when appropriate ("I once wondered if..." or "Isn't it strange how..."). Let hints of emotion come through naturally without overdramatizing.

9. Flexibility: Adapt details and examples to suit the topic while keeping a consistently friendly, conversational tone. The text should feel like an off-the-cuff, heartfelt conversation.`;

type BossJob = {
  id: string;
  name: QueueName;
  data?: Record<string, unknown>;
};

type SiteContext = {
  id: string;
  name: string;
  base_url: string;
  wordpress_url: string;
  status: string;
  posts_per_day: number;
  location_code: string | null;
  language_code: string | null;
  auto_post: boolean;
  wordpress_post_status: "draft" | "publish";
  setup_state: SiteSetupState;
  credentials_test_state: CredentialTestState;
  image_density_pct: number;
  keyword_max_difficulty: number;
  keyword_min_search_volume: number;
  wordpress_username: string | null;
  wordpress_application_password: string | null;
  secrets_encrypted: string | null;
};

async function getSiteContext(siteId: string): Promise<SiteContext | null> {
  const result = await query<SiteContext>(
    `
      select
        s.id,
        s.name,
        s.base_url,
        s.wordpress_url,
        s.status,
        s.posts_per_day,
        s.location_code,
        s.language_code,
        coalesce(ss.auto_post, false) as auto_post,
        coalesce(ss.wordpress_post_status, 'publish') as wordpress_post_status,
        coalesce(su.setup_state, 'needs_setup') as setup_state,
        coalesce(su.credentials_test_state, 'untested') as credentials_test_state,
        coalesce(ss.image_density_pct, 100) as image_density_pct,
        coalesce(ss.keyword_max_difficulty, 40) as keyword_max_difficulty,
        coalesce(ss.keyword_min_search_volume, 100) as keyword_min_search_volume,
        sc.wordpress_username,
        sc.wordpress_application_password,
        sc.secrets_encrypted
      from sites s
      left join site_settings ss on ss.site_id = s.id
      left join site_setup su on su.site_id = s.id
      left join site_credentials sc on sc.site_id = s.id
      where s.id = $1
    `,
    [siteId],
  );

  return result.rows[0] ?? null;
}

function getWordPressCredentials(site: SiteContext): WordPressCredentials | null {
  const wordpressApplicationPassword = readWordPressApplicationPassword(site);

  if (!site.wordpress_username || !wordpressApplicationPassword) {
    return null;
  }

  return {
    baseUrl: site.wordpress_url,
    username: site.wordpress_username,
    applicationPassword: wordpressApplicationPassword,
  };
}

function extractH2Headings(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "))
    .map((line) => line.replace(/^##\s+/, "").trim())
    .filter(Boolean);
}

async function buildBlogImagePlan(title: string, keyword: string, article: string, imageDensityPct: number) {
  const headings = extractH2Headings(article).filter((heading) => !isFaqHeading(heading));
  const selectedHeadings = selectHeadingsForImageDensity(
    headings,
    normalizeImageDensityPct(imageDensityPct, DEFAULT_IMAGE_DENSITY_PCT),
  );

  // Build the list of images we need: 1 hero + a density-based subset of H2 sections.
  const slots: Array<{ placementKey: string; role: string; heading: string | null }> = [
    { placementKey: "hero", role: "hero", heading: null },
  ];

  for (const heading of selectedHeadings) {
    slots.push({
      placementKey: `${slugify(heading)}-1`,
      role: "section",
      heading,
    });
  }

  // Use LLM to generate all image prompts at once, so it can see the full article
  // and ensure variety across images (different angles, styles, compositions)
  const slotDescriptions = slots.map((s, i) =>
    s.role === "hero"
      ? `Image ${i + 1} (HERO): Featured hero image for the entire article`
      : `Image ${i + 1} (SECTION): Image for the section "${s.heading}"`,
  ).join("\n");

  const generated = await generateJson(
    `You are generating image prompts for a blog article. You must create ALL prompts at once so you can ensure VARIETY across the full set. No two images should look similar.

Article title: ${title}
Keyword: ${keyword}
Article content (excerpt):
${article.slice(0, 3000)}

Images needed:
${slotDescriptions}

IMAGE PROMPT RULES:
- Each prompt must feel like a REAL AMATEUR PHOTO: slightly imperfect, not cinematic, not hyper-polished, not an illustration or 3D render.
- Describe what a camera sees: concrete subject, setting, key details, mood.
- NEVER use words like: illustration, icon, graphic, concept art, vector, 3D render, digital art.
- Max 130 characters per prompt. No quotation marks or special characters in the prompt.
- If people appear, show at most 2 people described by simple roles (e.g., "young office worker", "parent"), no names.
- VARY composition across prompts: mix close-ups, wider scenes, different angles, distances, and environments.
- VARY the style: mix candid smartphone photos, slightly grainy film photos, casual lifestyle snapshots, documentary style.
- VARY lighting: soft morning light, overcast daylight, warm indoor lamp, harsh midday sun, evening blue hour.
- Include subtle imperfections: slightly imperfect focus, a bit of motion blur, subtle digital noise, older smartphone look.
- The HERO image should feel broader and more iconic, hinting at the main theme. It should have space that works as a header image.
- SECTION images should specifically illustrate their section's content, not the general article topic.

For each image, also generate a short, descriptive alt text (under 80 characters).

Return JSON: {"images": [{"prompt": "...", "altText": "..."}]}
The array must have exactly ${slots.length} entries, in the same order as the images listed above.`,
    {
      images: slots.map((s) => ({
        prompt: s.role === "hero"
          ? `Casual photo of ${keyword} related scene, warm natural light, slightly out of focus background`
          : `Amateur snapshot of ${s.heading ?? keyword}, eye level, soft daylight, subtle grain`,
        altText: s.role === "hero" ? `${title}` : `${s.heading ?? keyword}`,
      })),
    },
  );

  const images = (generated.images ?? []) as Array<{ prompt: string; altText: string }>;

  return slots.map((slot, index) => ({
    placementKey: slot.placementKey,
    role: slot.role,
    altText: (images[index]?.altText ?? `${slot.heading ?? title} image`).slice(0, 80),
    prompt: (images[index]?.prompt ?? `Casual photo related to ${slot.heading ?? keyword}, natural light, slight grain`).slice(0, 130),
    metadata: { heading: slot.heading, headingIndex: slot.heading ? headings.indexOf(slot.heading) : -1, assetIndex: 0 },
  }));
}

type SiteSetupRow = {
  setup_state: SiteSetupState;
  basics_state: SiteStepState;
  credentials_test_state: CredentialTestState;
  wordpress_sync_state: SiteStepState;
  profile_state: SiteStepState;
  keyword_state: SiteStepState;
  ready_at: string | null;
};

async function loadSiteSetup(siteId: string): Promise<SiteSetupRow> {
  const result = await query<SiteSetupRow>(
    `
      select
        coalesce(setup_state, 'needs_setup') as setup_state,
        coalesce(basics_state, 'pending') as basics_state,
        coalesce(credentials_test_state, 'untested') as credentials_test_state,
        coalesce(wordpress_sync_state, 'blocked') as wordpress_sync_state,
        coalesce(profile_state, 'blocked') as profile_state,
        coalesce(keyword_state, 'blocked') as keyword_state,
        ready_at
      from site_setup
      where site_id = $1
      limit 1
    `,
    [siteId],
  );

  return (
    result.rows[0] ?? {
      setup_state: "needs_setup",
      basics_state: "pending",
      credentials_test_state: "untested",
      wordpress_sync_state: "blocked",
      profile_state: "blocked",
      keyword_state: "blocked",
      ready_at: null,
    }
  );
}

async function updateSiteSetup(
  siteId: string,
  updates: Partial<{
    setup_state: SiteSetupState;
    basics_state: SiteStepState;
    credentials_test_state: CredentialTestState;
    credentials_saved_at: string | null;
    credentials_tested_at: string | null;
    credentials_test_message: string | null;
    wordpress_sync_state: SiteStepState;
    wordpress_sync_message: string | null;
    profile_state: SiteStepState;
    profile_message: string | null;
    keyword_state: SiteStepState;
    keyword_message: string | null;
    initiated_at: string | null;
    ready_at: string | null;
  }>,
) {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return;
  }

  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  const values = entries.map(([, value]) => value);

  await query(
    `
      update site_setup
      set ${assignments.join(", ")},
          updated_at = now()
      where site_id = $1
    `,
    [siteId, ...values],
  );
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return "";
    }
    return response.text();
  } catch {
    return "";
  }
}

async function fetchReadableText(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { title: "", text: "" };
    }

    const html = await response.text();

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";

    // Remove layout noise elements, then scripts/styles, then all tags
    const text = html
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    return { title, text };
  } catch {
    return { title: "", text: "" };
  }
}

function discoverSameOriginPages(rootUrl: string, html: string) {
  const root = new URL(rootUrl);
  const candidates = new Map<string, number>();
  const matches = html.matchAll(/href=["']([^"'#]+)["']/gi);

  for (const match of matches) {
    const href = match[1]?.trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }

    try {
      const target = new URL(href, root);
      if (target.origin !== root.origin) {
        continue;
      }

      target.hash = "";
      target.search = "";
      if (/\.(jpg|jpeg|png|gif|svg|pdf|xml)$/i.test(target.pathname)) {
        continue;
      }

      const normalized = target.toString().replace(/\/$/, "");
      const path = `${target.pathname}${target.search}`.toLowerCase();
      let score = 0;
      if (path === "" || path === "/") {
        score += 5;
      }
      if (/(about|company|services|service|blog|news|contact|team|work|solutions|expertise)/.test(path)) {
        score += 10;
      }
      score -= path.split("/").length;

      candidates.set(normalized, Math.max(score, candidates.get(normalized) ?? Number.NEGATIVE_INFINITY));
    } catch {
      continue;
    }
  }

  return Array.from(candidates.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([url]) => url)
    .filter((url) => url !== root.toString().replace(/\/$/, ""))
    .slice(0, 5);
}

async function discoverFromSitemap(baseUrl: string): Promise<string[]> {
  try {
    const sitemapUrl = `${baseUrl.replace(/\/$/, "")}/sitemap.xml`;
    const response = await fetch(sitemapUrl, { cache: "no-store" });
    if (!response.ok) return [];
    const xml = await response.text();

    const urls: string[] = [];
    const locMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    const root = new URL(baseUrl);
    for (const match of locMatches) {
      const loc = match[1]?.trim();
      if (!loc) continue;
      try {
        const target = new URL(loc);
        if (target.origin === root.origin && !/\.(xml|gz)$/i.test(target.pathname)) {
          urls.push(target.toString());
        }
      } catch { /* skip invalid URLs */ }
    }
    return urls;
  } catch {
    return [];
  }
}

async function fetchSiteCorpus(baseUrl: string) {
  const homepageHtml = await fetchHtml(baseUrl);
  const linkPages = discoverSameOriginPages(baseUrl, homepageHtml);
  const sitemapPages = await discoverFromSitemap(baseUrl);

  // Merge and deduplicate, preferring link-discovered pages (higher relevance scoring)
  const seen = new Set<string>();
  const pages = [baseUrl];
  for (const url of [...linkPages, ...sitemapPages]) {
    const normalized = url.replace(/\/$/, "");
    if (!seen.has(normalized) && normalized !== baseUrl.replace(/\/$/, "")) {
      seen.add(normalized);
      pages.push(url);
    }
    if (pages.length >= 7) break;
  }

  const results = await Promise.all(pages.map((url) => fetchReadableText(url)));

  return pages
    .map((url, index) => ({ url, ...results[index] }))
    .filter((page) => page.text)
    .map((page) => `[${page.title || page.url}] ${page.url}\n${page.text}`)
    .join("\n\n");
}

async function writeSiteProfile(siteId: string, profile: Record<string, unknown>) {
  // Build readable text versions for the simple text columns
  const toneGuide = profile.toneGuide;
  const toneGuideText = typeof toneGuide === "string"
    ? toneGuide
    : typeof toneGuide === "object" && toneGuide
      ? `${(toneGuide as Record<string, unknown>).voiceType ?? "Clear"}. Formality: ${(toneGuide as Record<string, unknown>).formality ?? 3}/5. ${(toneGuide as Record<string, unknown>).sentenceStyle ?? ""}`
      : "Clear, direct, helpful";

  const avatarMap = profile.avatarMap;
  const audienceText = typeof avatarMap === "object" && avatarMap
    ? String((avatarMap as Record<string, unknown>).primaryAudience
      ? JSON.stringify((avatarMap as Record<string, unknown>).primaryAudience)
      : profile.audienceSummary ?? "General audience")
    : String(profile.audienceSummary ?? "General audience");

  await query(
    `
      insert into site_profiles (site_id, site_summary, audience_summary, tone_guide, niche_summary, profile_json, avatar_map_json, topic_pillar_map_json, content_exclusions_json)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (site_id) do update
      set site_summary = excluded.site_summary,
          audience_summary = excluded.audience_summary,
          tone_guide = excluded.tone_guide,
          niche_summary = excluded.niche_summary,
          profile_json = excluded.profile_json,
          avatar_map_json = excluded.avatar_map_json,
          topic_pillar_map_json = excluded.topic_pillar_map_json,
          content_exclusions_json = excluded.content_exclusions_json
    `,
    [
      siteId,
      String(profile.siteSummary ?? ""),
      audienceText,
      toneGuideText,
      String(profile.nicheSummary ?? ""),
      JSON.stringify(profile),
      JSON.stringify(profile.avatarMap ?? {}),
      JSON.stringify(profile.topicPillars ?? []),
      JSON.stringify(profile.exclusions ?? []),
    ],
  );
}

async function countUnusedKeywords(siteId: string) {
  const result = await query<{ available_count: number }>(
    `
      select count(k.id) filter (where k.used = false and k.category_id is not null and coalesce(sc.active, false) = true)::int as available_count
      from keyword_candidates k
      left join site_categories sc on sc.id = k.category_id
      where k.site_id = $1
    `,
    [siteId],
  );

  return result.rows[0]?.available_count ?? 0;
}

type CategoryOption = {
  id: string;
  name: string;
};

type KeywordPipelineOptions = {
  enqueueNext?: boolean;
  researchRunId?: string;
};

type KeywordPersistOptions = {
  effectiveTarget?: KeywordTarget;
  researchRunId?: string;
};

type KeywordResearchRunResult = {
  finalInventoryCount: number;
  insertedCount: number;
  attemptCount: number;
  qualifyingCount: number;
  requiredCount: number;
  startingTarget: KeywordTarget;
  effectiveTarget: KeywordTarget;
  researchRunId: string;
};

function normalizeCategoryText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryTokens(value: string | null | undefined) {
  return new Set(normalizeCategoryText(value).split(/\s+/).filter(Boolean));
}

function countTokenOverlap(left: Set<string>, right: Set<string>) {
  let matches = 0;
  for (const token of left) {
    if (right.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function resolveKeywordCategoryId(
  categories: CategoryOption[],
  {
    requestedName,
    keyword,
    clusterLabel,
    existingCategoryId,
  }: {
    requestedName?: string | null;
    keyword?: string | null;
    clusterLabel?: string | null;
    existingCategoryId?: string | null;
  },
) {
  if (categories.length === 0) {
    return existingCategoryId ?? null;
  }

  const requestedNormalized = normalizeCategoryText(requestedName);
  const requestedTokens = categoryTokens(requestedName);
  const keywordTokens = categoryTokens(keyword);
  const clusterTokens = categoryTokens(clusterLabel);

  const exactMatch = requestedNormalized
    ? categories.find((category) => normalizeCategoryText(category.name) === requestedNormalized)
    : null;
  if (exactMatch) {
    return exactMatch.id;
  }

  const scored = categories
    .map((category) => {
      const nameNormalized = normalizeCategoryText(category.name);
      const nameTokens = categoryTokens(category.name);
      let score = 0;

      if (requestedNormalized) {
        if (requestedNormalized.includes(nameNormalized) || nameNormalized.includes(requestedNormalized)) {
          score += 40;
        }
        score += countTokenOverlap(requestedTokens, nameTokens) * 15;
      }

      score += countTokenOverlap(keywordTokens, nameTokens) * 5;
      score += countTokenOverlap(clusterTokens, nameTokens) * 8;

      if (nameNormalized === "general" || nameNormalized === "blog" || nameNormalized === "misc" || nameNormalized === "other") {
        score += 2;
      }

      if (nameNormalized === "spiritual meaning") {
        score += 3;
      }

      return { id: category.id, score };
    })
    .sort((left, right) => right.score - left.score);

  if ((scored[0]?.score ?? 0) > 0) {
    return scored[0]?.id ?? existingCategoryId ?? categories[0]?.id ?? null;
  }

  return existingCategoryId ?? categories[0]?.id ?? null;
}

function getSiteKeywordTarget(site: SiteContext): KeywordTarget {
  return normalizeKeywordTarget({
    maxDifficulty: site.keyword_max_difficulty,
    minSearchVolume: site.keyword_min_search_volume,
  });
}

async function countQualifyingKeywordsForRun(siteId: string, researchRunId: string, target: KeywordTarget) {
  const normalizedTarget = normalizeKeywordTarget(target);
  const result = await query<{ qualifying_count: number }>(
    `
      select count(*)::int as qualifying_count
      from keyword_candidates k
      left join site_categories sc on sc.id = k.category_id
      where k.site_id = $1
        and coalesce(k.used, false) = false
        and k.category_id is not null
        and coalesce(sc.active, false) = true
        and coalesce(k.metadata_json->>'researchRunId', '') = $2
        and k.search_volume is not null
        and k.difficulty is not null
        and k.search_volume >= $3
        and k.difficulty <= $4
    `,
    [siteId, researchRunId, normalizedTarget.minSearchVolume, normalizedTarget.maxDifficulty],
  );

  return result.rows[0]?.qualifying_count ?? 0;
}

async function runAdaptiveKeywordResearch(siteId: string, requiredCount: number): Promise<KeywordResearchRunResult> {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const normalizedRequiredCount = Math.max(1, Math.floor(requiredCount));
  const startingTarget = getSiteKeywordTarget(site);
  const targetSequence = buildKeywordTargetSequence(startingTarget);
  const researchRunId = randomUUID();
  let insertedCount = 0;
  let qualifyingCount = 0;
  let effectiveTarget = startingTarget;

  for (const target of targetSequence) {
    effectiveTarget = target;
    const remainingCount = Math.max(normalizedRequiredCount - qualifyingCount, 1);
    const batchSize = Math.min(Math.max(remainingCount, 8), 25);

    const generated = await handleKeywordSeedGenerate(siteId, batchSize, {
      enqueueNext: false,
      researchRunId,
    });
    insertedCount += generated.inserted;

    const expanded = await handleKeywordsExpand(siteId, {
      enqueueNext: false,
      researchRunId,
    });
    insertedCount += expanded.expanded;

    await handleKeywordsClusterReview(siteId, {
      enqueueNext: false,
      researchRunId,
    });

    qualifyingCount = await countQualifyingKeywordsForRun(siteId, researchRunId, target);
    if (qualifyingCount >= normalizedRequiredCount) {
      const persisted = await handleKeywordsPersist(siteId, {
        effectiveTarget: target,
        researchRunId,
      });

      await query(
        `
          update site_settings
          set keyword_max_difficulty = $2,
              keyword_min_search_volume = $3,
              updated_at = now()
          where site_id = $1
        `,
        [siteId, target.maxDifficulty, target.minSearchVolume],
      );

      return {
        finalInventoryCount: persisted.finalCount,
        insertedCount,
        attemptCount: targetSequence.indexOf(target) + 1,
        qualifyingCount: persisted.qualifyingCount,
        requiredCount: normalizedRequiredCount,
        startingTarget,
        effectiveTarget: target,
        researchRunId,
      };
    }
  }

  throw new Error(
    `Keyword research found ${qualifyingCount} qualifying keywords out of ${normalizedRequiredCount}. Started at ${formatKeywordTarget(startingTarget)} and ended at ${formatKeywordTarget(effectiveTarget)}.`,
  );
}

async function handleSiteInitiate(siteId: string) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const credentials = getWordPressCredentials(site);
  if (!credentials || site.credentials_test_state !== "passed") {
    throw new Error("The site cannot be initiated until WordPress credentials are saved and tested.");
  }

  const setup = await loadSiteSetup(siteId);
  const prerequisitesPassed = setup.basics_state === "passed" && setup.credentials_test_state === "passed";
  const queuedFromUi =
    setup.setup_state === "initializing" &&
    setup.wordpress_sync_state === "pending" &&
    setup.profile_state === "pending" &&
    setup.keyword_state === "pending";
  const readyToStart = !setup.ready_at && prerequisitesPassed && (setup.setup_state === "ready_to_initiate" || queuedFromUi);

  if (!readyToStart) {
    throw new Error("The site is not ready to initiate yet.");
  }

  await updateSiteSetup(siteId, {
    setup_state: "initializing",
    wordpress_sync_state: "running",
    wordpress_sync_message: "Syncing WordPress authors and categories...",
    profile_state: "pending",
    profile_message: null,
    keyword_state: "pending",
    keyword_message: null,
  });

  try {
    const syncResult = await syncWordPressEntities(siteId, credentials);
    if (syncResult.activeAuthors < 1 || syncResult.activeCategories < 1) {
      throw new Error("Select at least one active WordPress author and one active category before initiating the site.");
    }

    const importResult = await importExistingPostKeywords(siteId, credentials);

    await updateSiteSetup(siteId, {
      wordpress_sync_state: "passed",
      wordpress_sync_message:
        `Imported ${syncResult.authors} eligible authors and ${syncResult.categories} categories. ` +
        `${syncResult.activeAuthors} authors and ${syncResult.activeCategories} categories are currently selected.` +
        (importResult.postsFound > 0
          ? ` Found ${importResult.postsFound} existing posts; imported ${importResult.keywordsImported} keywords.`
          : ""),
      profile_state: "running",
      profile_message: "Scraping site pages and generating site profile...",
    });
  } catch (error) {
    await updateSiteSetup(siteId, {
      setup_state: "attention",
      wordpress_sync_state: "failed",
      wordpress_sync_message: error instanceof Error ? error.message : "WordPress sync failed.",
    });
    throw error;
  }

  try {
    const siteCorpus = await fetchSiteCorpus(site.base_url);
    const corpusContext = `Site name: ${site.name}\nSite URL: ${site.base_url}\n\nScraped site corpus:\n${siteCorpus}`;

    // Step A3: Site summary + niche summary
    const summaries = await generateJson(
      `You are analyzing a website to understand what it does and what niche it belongs to.

${corpusContext}

Return JSON with:
- siteSummary: 2-3 sentences explaining what this site/business does, what problems it solves, and what products or services it offers.
- nicheSummary: A concise label for the site's niche or industry (e.g., "B2B SaaS project management", "residential interior design", "organic pet food e-commerce").`,
      {
        siteSummary: `${site.name} publishing property`,
        nicheSummary: "General content site",
      },
    );

    // Step A4: Tone of voice guide (structured), built on top of the base writing style
    const toneGuide = await generateJson(
      `You are creating a site-specific writing style guide for a content automation system.

Below is the BASE writing style guide that applies to ALL sites. Your job is to analyze THIS specific website and produce a SITE-SPECIFIC tone guide that builds on top of the base. The site-specific guide should capture what makes this site's voice UNIQUE, not repeat generic writing advice.

${BASE_WRITING_STYLE}

Now analyze this specific website:
${corpusContext}

Produce a site-specific tone guide that layers ON TOP of the base style. Focus on what's unique to this site's voice, not generic writing advice (the base guide already covers that).

Return JSON with:
- voiceType: The overall voice character specific to this site (e.g., "Warm wellness mentor", "No-nonsense tech reviewer", "Enthusiastic travel storyteller")
- formality: Level from 1-5 (1=very casual, 5=very formal) - where does this site sit?
- topicPersonality: How this site's personality shows through when discussing its niche (e.g., "Uses personal anecdotes about failed recipes", "References pop culture when explaining code concepts")
- vocabularyNotes: Site-specific vocabulary patterns (e.g., "Uses 'journey' and 'transformation' frequently", "Avoids clinical terms, prefers warm alternatives like 'challenge' over 'problem'")
- doList: Array of 3-5 things THIS site's writing does that make it distinctive
- avoidList: Array of 3-5 things THIS site specifically avoids (beyond the base guide's rules)
- openingStyle: How this site typically opens articles, with a specific example adapted from the corpus
- signaturePhrasings: Array of 2-3 characteristic phrases or sentence patterns this site uses`,
      {
        voiceType: "Clear and direct",
        formality: 3,
        sentenceStyle: "Medium-length, active voice",
        vocabularyLevel: "Accessible, minimal jargon",
        doList: ["Use clear language", "Address the reader directly", "Provide practical examples"],
        avoidList: ["Avoid overly salesy language", "Avoid jargon without explanation"],
        openingStyle: "Direct statement of the topic",
        ctaStyle: "Clear, action-oriented",
      },
    );

    // Step A5: Avatar map (audience personas)
    const avatarMap = await generateJson(
      `Based on this website, identify the target audience personas.

${corpusContext}

Return JSON with:
- primaryAudience: Object with name, description, goals (array), painPoints (array), knowledgeLevel (beginner/intermediate/expert)
- secondaryAudience: Object with same structure, or null if only one clear audience
- languagePreferences: How the audience expects to be addressed (e.g., "Uses industry terminology", "Prefers step-by-step explanations")
- trustSignals: What builds credibility with this audience (e.g., "Data and statistics", "Expert credentials", "Case studies")`,
      {
        primaryAudience: {
          name: "General reader",
          description: "Someone interested in the site's topic",
          goals: ["Learn about the topic", "Find solutions"],
          painPoints: ["Lack of clear information"],
          knowledgeLevel: "intermediate",
        },
        secondaryAudience: null,
        languagePreferences: "Clear, accessible language",
        trustSignals: ["Expertise", "Practical examples"],
      },
    );

    // Step A6: Topic pillar map
    // Fetch existing WordPress categories to inform pillar-to-category mapping
    const existingCategories = await query<{ name: string }>(
      "select name from site_categories where site_id = $1 and active = true",
      [siteId],
    );
    const categoryNames = existingCategories.rows.map((c) => c.name);

    const topicPillars = await generateJson(
      `Based on this website, define 3-5 main content topic pillars that organize what this site should write about.

${corpusContext}

Existing WordPress categories: ${categoryNames.join(", ") || "none yet"}

Return JSON with pillars as an array, each containing:
- name: Short pillar name (e.g., "Home Organization Tips")
- description: What content belongs in this pillar
- exclusions: What does NOT belong in this pillar
- suggestedCategory: Which existing WordPress category best matches, or a suggested new category name
- exampleTopics: Array of 3-5 example article topics for this pillar`,
      {
        pillars: [
          {
            name: "General",
            description: "General content about the site's main topic",
            exclusions: "Off-topic content",
            suggestedCategory: categoryNames[0] ?? "General",
            exampleTopics: ["Introduction to the topic"],
          },
        ],
      },
    );

    // Step A7: Content exclusions
    const exclusions = await generateJson(
      `Based on this website's niche and audience, define content exclusions -- topics, phrases, and claims that should be avoided in all content produced for this site.

Site niche: ${String(summaries.nicheSummary)}
Site summary: ${String(summaries.siteSummary)}

Return JSON with:
- offNicheTopics: Array of topics that are outside this site's niche and should never be covered
- bannedPhrases: Array of overused, salesy, or cliched phrases to avoid (e.g., "In today's fast-paced world", "game-changer", "synergy")
- riskyTopics: Array of topics that could be legally, medically, or ethically problematic for this niche
- bannedClaims: Array of claim types to avoid (e.g., "guaranteed results", "best in the industry")`,
      {
        offNicheTopics: [],
        bannedPhrases: ["In today's fast-paced world", "game-changer"],
        riskyTopics: [],
        bannedClaims: [],
      },
    );

    // Step A9: Assemble and write the complete profile package
    const fullProfile = {
      ...summaries,
      toneGuide,
      avatarMap,
      topicPillars: (topicPillars as { pillars?: unknown[] }).pillars ?? topicPillars,
      exclusions,
    };

    await writeSiteProfile(siteId, fullProfile);
    await updateSiteSetup(siteId, {
      profile_state: "passed",
      profile_message: "Site profile saved.",
      keyword_state: "running",
      keyword_message: "Building initial keyword inventory...",
    });
  } catch (error) {
    await updateSiteSetup(siteId, {
      setup_state: "attention",
      profile_state: "failed",
      profile_message: error instanceof Error ? error.message : "Site profile generation failed.",
    });
    throw error;
  }

  const targetKeywordCount = Math.max(site.posts_per_day * 30, 5);

  try {
    const availableCount = await countUnusedKeywords(siteId);
    let finalInventoryCount = availableCount;
    let keywordMessage = `Initial keyword inventory already met target with ${availableCount} unused keywords.`;

    if (availableCount < targetKeywordCount) {
      const requiredCount = targetKeywordCount - availableCount;
      const keywordResearch = await runAdaptiveKeywordResearch(siteId, requiredCount);
      finalInventoryCount = keywordResearch.finalInventoryCount;
      keywordMessage =
        `Initial keyword inventory ready with ${finalInventoryCount} unused keywords. ` +
        `Started at ${formatKeywordTarget(keywordResearch.startingTarget)} and settled on ${formatKeywordTarget(keywordResearch.effectiveTarget)} ` +
        `after ${keywordResearch.attemptCount} attempt${keywordResearch.attemptCount === 1 ? "" : "s"}, ` +
        `producing ${keywordResearch.qualifyingCount} qualifying keywords (${keywordResearch.insertedCount} inserted this run).`;
    }

    if (finalInventoryCount < targetKeywordCount) {
      throw new Error(`Keyword research finished with ${finalInventoryCount} unused keywords; ${targetKeywordCount} are required.`);
    }

    await withTransaction(async (client) => {
      await client.query("update sites set status = 'active' where id = $1", [siteId]);
      await client.query(
        `
          update site_setup
          set setup_state = 'ready',
              wordpress_sync_state = 'passed',
              profile_state = 'passed',
              keyword_state = 'passed',
              keyword_message = $2,
              ready_at = now(),
              updated_at = now()
          where site_id = $1
        `,
        [siteId, keywordMessage],
      );
    });
  } catch (error) {
    await updateSiteSetup(siteId, {
      setup_state: "attention",
      keyword_state: "failed",
      keyword_message: error instanceof Error ? error.message : "Keyword research failed.",
    });
    throw error;
  }

  return { siteId, initiated: true };
}

async function handleSiteWordpressSync(siteId: string) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const credentials = getWordPressCredentials(site);
  if (!credentials) {
    return { synced: false, reason: "Missing WordPress credentials" };
  }

  return syncWordPressEntities(siteId, credentials);
}

async function handleKeywordsInventoryAudit(siteId?: string) {
  // Replenish when inventory falls below ~3 days of capacity (per process doc Rule 4)
  // Target is 30 days of supply (per process doc Rule 5)
  const result = await query<{ id: string; missing_count: number; target_count: number }>(`
    with keyword_totals as (
      select
        s.id,
        greatest((coalesce(ss.allow_blog, true)::int * greatest(s.posts_per_day, 1) * 30), 5) as desired_count,
        greatest(s.posts_per_day, 1) * 3 as low_water_mark,
        count(k.id) filter (
          where coalesce(k.used, false) = false
            and k.category_id is not null
            and coalesce(sc.active, false) = true
        ) as available_count
      from sites s
      left join site_settings ss on ss.site_id = s.id
      left join site_setup su on su.site_id = s.id
      left join keyword_candidates k on k.site_id = s.id
      left join site_categories sc on sc.id = k.category_id
      where coalesce(su.setup_state, 'needs_setup') = 'ready'
        and coalesce(su.credentials_test_state, 'untested') = 'passed'
        and coalesce(ss.allow_blog, false) = true
        and ($1::uuid is null or s.id = $1::uuid)
        and exists (
          select 1
          from site_authors sa
          where sa.site_id = s.id
            and sa.active = true
            and sa.wp_author_id is not null
        )
        and exists (
          select 1
          from site_categories sc2
          where sc2.site_id = s.id
            and sc2.active = true
            and sc2.wp_category_id is not null
        )
      group by s.id, ss.allow_blog, s.posts_per_day
    )
    select id, (desired_count - available_count)::int as missing_count, desired_count::int as target_count
    from keyword_totals
    where available_count < low_water_mark
  `, [siteId ?? null]);

  for (const row of result.rows) {
    await enqueueJob("keywords.seed_generate", { siteId: row.id, requiredCount: row.missing_count }, "site", row.id);
  }

  return { queued: result.rowCount };
}

async function handleKeywordSeedGenerate(siteId: string, batchSize: number, options: KeywordPipelineOptions = {}) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const profileResult = await query<{
    niche_summary: string | null;
    audience_summary: string | null;
    tone_guide: string | null;
    topic_pillar_map_json: unknown;
    content_exclusions_json: unknown;
  }>(
    "select niche_summary, audience_summary, tone_guide, topic_pillar_map_json, content_exclusions_json from site_profiles where site_id = $1",
    [siteId],
  );
  const categoriesResult = await query<{ id: string; name: string }>(
    "select id, name from site_categories where site_id = $1 and active = true order by usage_count asc, name asc limit 20",
    [siteId],
  );
  if (categoriesResult.rows.length === 0) {
    throw new Error("No active WordPress categories are selected for this site.");
  }

  // Load existing and used keywords to avoid duplicates
  const existingKeywords = await query<{ keyword: string }>(
    "select keyword from keyword_candidates where site_id = $1 order by created_at desc limit 500",
    [siteId],
  );
  const existingList = existingKeywords.rows.map((r) => r.keyword);

  const profile = profileResult.rows[0];
  const niche = profile?.niche_summary ?? site.name;
  const audience = profile?.audience_summary ?? "general readers";
  const pillars = profile?.topic_pillar_map_json;
  const exclusions = profile?.content_exclusions_json;
  const categoryNames = categoriesResult.rows.map((row) => row.name);

  const fallbackKeywords = Array.from({ length: batchSize }, (_, index) => ({
    keyword: `${site.name} ${categoryNames[index % Math.max(1, categoryNames.length)] ?? "guide"} ${index + 1}`.trim(),
    category: categoryNames[index % Math.max(1, categoryNames.length)] ?? null,
    clusterLabel: null,
    searchVolume: null,
    difficulty: null,
  }));

  let dataForSeoEvidence: unknown = null;
  try {
    dataForSeoEvidence = await dataForSeoPost("/dataforseo_labs/google/keyword_suggestions/live", [
      {
        keyword: niche,
        location_code: Number(site.location_code) || 2840,
        language_code: site.language_code || "en",
        include_seed_keyword: true,
        limit: 20,
      },
    ]);
  } catch {
    dataForSeoEvidence = null;
  }

  const pillarContext = Array.isArray(pillars) && pillars.length > 0
    ? `\nTopic pillars to target:\n${pillars.map((p: Record<string, unknown>) => `- ${p.name}: ${p.description}`).join("\n")}`
    : "";

  const exclusionContext = exclusions && typeof exclusions === "object"
    ? `\nContent exclusions (avoid these topics): ${JSON.stringify(exclusions)}`
    : "";

  const existingContext = existingList.length > 0
    ? `\nExisting keywords (do NOT repeat these): ${existingList.slice(0, 200).join(", ")}`
    : "";

  const generated = await generateJson(
    `Generate ${batchSize} editorial keywords for a WordPress site. Each keyword should be a specific, searchable article topic that can stand alone as a blog post.

Site: ${site.name}
Niche: ${niche}
Audience: ${audience}
Categories: ${categoryNames.join(", ")}
${pillarContext}${exclusionContext}${existingContext}
DataForSEO evidence: ${JSON.stringify(dataForSeoEvidence)}

Return JSON in the form {"keywords":[{"keyword":"...","category":"...","clusterLabel":"...","searchVolume":123,"difficulty":20}]}.
- keyword: A specific, long-tail search phrase suitable as a blog article topic
- category: Which category this keyword best fits (must be one of the listed categories)
- clusterLabel: A semantic grouping label for this keyword (e.g., "beginner guides", "product comparisons")
- searchVolume: Estimated monthly search volume (use your best estimate)
- difficulty: Estimated ranking difficulty 1-100 (lower is easier)`,
    { keywords: fallbackKeywords },
  );

  let inserted = 0;
  await withTransaction(async (client) => {
    for (const item of generated.keywords as Array<Record<string, unknown>>) {
      const categoryName = item.category ? String(item.category) : null;
      const keyword = String(item.keyword ?? "").trim().toLowerCase();
      if (!keyword) {
        continue;
      }

      const categoryId = resolveKeywordCategoryId(categoriesResult.rows, {
        requestedName: categoryName,
        keyword,
        clusterLabel: item.clusterLabel ? String(item.clusterLabel) : null,
      });

      const insertResult = await client.query(
        `
          insert into keyword_candidates (site_id, category_id, keyword, cluster_label, source, search_volume, difficulty, metadata_json)
          values ($1, $2, $3, $4, 'generated', $5, $6, $7)
          on conflict (site_id, keyword) do nothing
        `,
        [
          siteId,
          categoryId,
          keyword,
          item.clusterLabel ? String(item.clusterLabel) : categoryName,
          typeof item.searchVolume === "number" ? item.searchVolume : null,
          typeof item.difficulty === "number" ? item.difficulty : null,
          JSON.stringify({
            generatedAt: new Date().toISOString(),
            researchRunId: options.researchRunId ?? null,
          }),
        ],
      );
      inserted += insertResult.rowCount ?? 0;
    }
  });

  // Chain to the expand step for further enrichment
  if (options.enqueueNext ?? true) {
    await enqueueJob("keywords.expand", { siteId, researchRunId: options.researchRunId ?? null }, "site", siteId);
  }

  return { inserted };
}

async function handleKeywordsExpand(siteId: string, options: KeywordPipelineOptions = {}) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  // Get seed keywords that were recently generated (within last hour)
  const seedKeywords = await query<{ keyword: string }>(
    `
      select keyword
      from keyword_candidates
      where site_id = $1
        and source = 'generated'
        and (
          ($2::text is not null and coalesce(metadata_json->>'researchRunId', '') = $2)
          or ($2::text is null and created_at >= now() - interval '1 hour')
        )
      order by created_at desc
      limit 20
    `,
    [siteId, options.researchRunId ?? null],
  );

  if (seedKeywords.rows.length === 0) {
    if (options.enqueueNext ?? true) {
      await enqueueJob("keywords.cluster_review", { siteId, researchRunId: options.researchRunId ?? null }, "site", siteId);
    }
    return { expanded: 0, reason: "No recent seed keywords to expand" };
  }

  const keywords = seedKeywords.rows.map((r) => r.keyword);

  const locationCode = Number(site.location_code) || 2840;
  const languageCode = site.language_code || "en";

  // Use dataforseo_labs endpoints (semantic suggestions, not just volume lookup)
  let suggestions: unknown = null;
  try {
    suggestions = await dataForSeoPost("/dataforseo_labs/google/keyword_suggestions/live", [
      {
        keyword: keywords[0],
        location_code: locationCode,
        language_code: languageCode,
        include_seed_keyword: true,
        limit: 50,
      },
    ]);
  } catch {
    suggestions = null;
  }

  let ideas: unknown = null;
  try {
    ideas = await dataForSeoPost("/dataforseo_labs/google/keyword_ideas/live", [
      {
        keywords: keywords.slice(0, 5),
        location_code: locationCode,
        language_code: languageCode,
        limit: 50,
      },
    ]);
  } catch {
    ideas = null;
  }

  // Extract and insert expanded keywords from both endpoints
  let expanded = 0;
  const allExpanded: Array<{ keyword: string; volume: number | null; difficulty: number | null; source: string }> = [];

  // Parse keyword_suggestions results
  const sugResult = suggestions as { tasks?: Array<{ result?: Array<{ items?: Array<{ keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number }; keyword_properties?: { keyword_difficulty?: number } } }> }> }> } | null;
  for (const item of sugResult?.tasks?.[0]?.result?.[0]?.items ?? []) {
    const kw = item.keyword_data?.keyword?.trim().toLowerCase();
    if (kw) {
      allExpanded.push({
        keyword: kw,
        volume: item.keyword_data?.keyword_info?.search_volume ?? null,
        difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        source: "keyword_suggestions",
      });
    }
  }

  // Parse keyword_ideas results
  const ideaResult = ideas as { tasks?: Array<{ result?: Array<{ items?: Array<{ keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number }; keyword_properties?: { keyword_difficulty?: number } } }> }> }> } | null;
  for (const item of ideaResult?.tasks?.[0]?.result?.[0]?.items ?? []) {
    const kw = item.keyword_data?.keyword?.trim().toLowerCase();
    if (kw) {
      allExpanded.push({
        keyword: kw,
        volume: item.keyword_data?.keyword_info?.search_volume ?? null,
        difficulty: item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        source: "keyword_ideas",
      });
    }
  }

  // Deduplicate and insert
  const seen = new Set(keywords.map((k) => k.toLowerCase()));
  await withTransaction(async (client) => {
    for (const item of allExpanded) {
      if (seen.has(item.keyword)) continue;
      seen.add(item.keyword);

      const insertResult = await client.query(
        `insert into keyword_candidates (site_id, keyword, cluster_label, source, search_volume, difficulty, metadata_json)
         values ($1, $2, 'expanded', 'dataforseo', $3, $4, $5)
         on conflict (site_id, keyword) do nothing`,
        [
          siteId,
          item.keyword,
          item.volume,
          item.difficulty,
          JSON.stringify({
            expandedAt: new Date().toISOString(),
            source: item.source,
            researchRunId: options.researchRunId ?? null,
          }),
        ],
      );
      expanded += insertResult.rowCount ?? 0;
    }
  });

  // Chain to cluster review
  if (options.enqueueNext ?? true) {
    await enqueueJob("keywords.cluster_review", { siteId, researchRunId: options.researchRunId ?? null }, "site", siteId);
  }

  return { expanded };
}

async function handleKeywordsClusterReview(siteId: string, options: KeywordPipelineOptions = {}) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  // Load all unclustered/recently added keywords
  const keywordsResult = await query<{ id: string; keyword: string; cluster_label: string | null; category_id: string | null }>(
    `
      select id, keyword, cluster_label, category_id
      from keyword_candidates
      where site_id = $1
        and used = false
        and ($2::text is null or coalesce(metadata_json->>'researchRunId', '') = $2)
      order by created_at desc
      limit 200
    `,
    [siteId, options.researchRunId ?? null],
  );

  if (keywordsResult.rows.length === 0) {
    return { reviewed: 0 };
  }

  const profileResult = await query<{
    niche_summary: string | null;
    topic_pillar_map_json: unknown;
    content_exclusions_json: unknown;
  }>(
    "select niche_summary, topic_pillar_map_json, content_exclusions_json from site_profiles where site_id = $1",
    [siteId],
  );

  const categoriesResult = await query<{ id: string; name: string }>(
    "select id, name from site_categories where site_id = $1 and active = true order by usage_count asc, name asc",
    [siteId],
  );
  if (categoriesResult.rows.length === 0) {
    throw new Error("No active WordPress categories are selected for this site.");
  }

  const profile = profileResult.rows[0];
  const niche = profile?.niche_summary ?? site.name;
  const pillars = profile?.topic_pillar_map_json;
  const exclusions = profile?.content_exclusions_json;
  const categoryNames = categoriesResult.rows.map((r) => r.name);
  const keywordTexts = keywordsResult.rows.map((r) => r.keyword);

  // LLM call: semantic deduplication, clustering, niche-fit filtering
  const reviewed = await generateJson(
    `Review and clean this keyword list for a WordPress site.

Site: ${site.name}
Niche: ${niche}
Available categories: ${categoryNames.join(", ")}
Topic pillars: ${JSON.stringify(pillars)}
Content exclusions: ${JSON.stringify(exclusions)}

Keywords to review:
${keywordTexts.join("\n")}

Tasks:
1. Remove exact duplicates and near-duplicates (e.g., "best running shoes" and "best shoes for running" -- keep the better one)
2. Remove keywords that are off-niche or match the content exclusions
3. Remove keywords that are too broad (e.g., "shoes") or too narrow (e.g., "blue nike air max 90 size 12 sale 2024")
4. Assign each remaining keyword a clusterLabel (semantic group) and a category (from the available categories list)

Return JSON: {"approved":[{"keyword":"...","clusterLabel":"...","category":"..."}],"rejected":[{"keyword":"...","reason":"..."}]}`,
    {
      approved: keywordTexts.map((k) => ({ keyword: k, clusterLabel: "general", category: categoryNames[0] ?? "General" })),
      rejected: [],
    },
  );

  // Apply the review results
  const approvedMap = new Map(
    ((reviewed.approved ?? []) as Array<{ keyword: string; clusterLabel: string; category: string }>).map((a) => [a.keyword.toLowerCase(), a]),
  );
  const rejectedSet = new Set(
    ((reviewed.rejected ?? []) as Array<{ keyword: string }>).map((r) => r.keyword.toLowerCase()),
  );

  let updated = 0;
  let removed = 0;
  await withTransaction(async (client) => {
    for (const row of keywordsResult.rows) {
      const approved = approvedMap.get(row.keyword.toLowerCase());
      if (approved) {
        const categoryId = resolveKeywordCategoryId(categoriesResult.rows, {
          requestedName: approved.category,
          keyword: row.keyword,
          clusterLabel: approved.clusterLabel,
          existingCategoryId: row.category_id,
        });
        await client.query(
          "update keyword_candidates set cluster_label = $2, category_id = $3 where id = $1",
          [row.id, approved.clusterLabel, categoryId],
        );
        updated += 1;
      } else if (rejectedSet.has(row.keyword.toLowerCase())) {
        await client.query("delete from keyword_candidates where id = $1", [row.id]);
        removed += 1;
      }
    }
  });

  // Chain to persist step
  if (options.enqueueNext ?? true) {
    await enqueueJob("keywords.persist", { siteId, researchRunId: options.researchRunId ?? null }, "site", siteId);
  }

  return { updated, removed };
}

async function handleKeywordsPersist(siteId: string, options: KeywordPersistOptions = {}) {
  const site = await getSiteContext(siteId);
  if (!site) {
    throw new Error(`Site ${siteId} not found`);
  }

  const effectiveTarget = normalizeKeywordTarget(options.effectiveTarget ?? getSiteKeywordTarget(site));
  if (options.researchRunId) {
    await query(
      `
        delete from keyword_candidates
        where site_id = $1
          and coalesce(metadata_json->>'researchRunId', '') = $2
          and (
            search_volume is null
            or difficulty is null
            or search_volume < $3
            or difficulty > $4
          )
      `,
      [siteId, options.researchRunId, effectiveTarget.minSearchVolume, effectiveTarget.maxDifficulty],
    );
  }

  const targetCount = Math.max(site.posts_per_day * 30, 5);
  const availableCount = await countUnusedKeywords(siteId);
  let qualifyingCount = options.researchRunId
    ? await countQualifyingKeywordsForRun(siteId, options.researchRunId, effectiveTarget)
    : 0;

  // Step B11: Validate inventory coverage
  const clusterDistribution = await query<{ cluster_label: string | null; count: number }>(
    "select cluster_label, count(*)::int as count from keyword_candidates where site_id = $1 and used = false group by cluster_label order by count desc",
    [siteId],
  );

  const difficultyDistribution = await query<{ bucket: string; count: number }>(`
    select
      case
        when difficulty <= 30 then 'easy'
        when difficulty <= 60 then 'medium'
        else 'hard'
      end as bucket,
      count(*)::int as count
    from keyword_candidates
    where site_id = $1 and used = false and difficulty is not null
    group by bucket
  `, [siteId]);

  // If we have too many keywords, trim excess (keep the most balanced set)
  if (availableCount > targetCount * 1.2) {
    // Remove excess by deleting the most recently added, lowest-value keywords
    const excessCount = availableCount - targetCount;
    await query(
      `
        delete from keyword_candidates
        where id in (
          select id from keyword_candidates
          where site_id = $1 and used = false
          order by
            case
              when search_volume is null or difficulty is null then 0
              when search_volume >= $3 and difficulty <= $4 then 2
              else 1
            end asc,
            coalesce(search_volume, 0) asc,
            coalesce(difficulty, 100) desc,
            created_at desc
          limit $2
        )
      `,
      [siteId, excessCount, effectiveTarget.minSearchVolume, effectiveTarget.maxDifficulty],
    );
  }

  const finalCount = await countUnusedKeywords(siteId);
  if (options.researchRunId) {
    qualifyingCount = await countQualifyingKeywordsForRun(siteId, options.researchRunId, effectiveTarget);
  }

  return {
    siteId,
    targetCount,
    finalCount,
    qualifyingCount,
    effectiveTarget,
    clusterDistribution: clusterDistribution.rows,
    difficultyDistribution: difficultyDistribution.rows,
    healthy: finalCount >= site.posts_per_day * 3,
  };
}

async function handleRssPoll(siteId?: string) {
  const subscriptions = await query<{
    subscription_id: string;
    feed_id: string;
    url: string;
  }>(`
    select sub.id as subscription_id, sub.feed_id, f.url
    from site_rss_subscriptions sub
    join rss_feeds f on f.id = sub.feed_id
    where sub.active = true and f.active = true
      and ($1::uuid is null or sub.site_id = $1::uuid)
  `, [siteId ?? null]);

  let itemCount = 0;

  for (const subscription of subscriptions.rows) {
    try {
      const feed = await parseFeed(subscription.url);

      await withTransaction(async (client) => {
        for (const item of feed.items.slice(0, 20)) {
          const sourceUrl = item.link ?? item.guid ?? `${subscription.url}#${randomUUID()}`;
          await client.query(
            `
              insert into rss_items (feed_id, external_guid, source_url, title, summary, raw_content, image_url, published_at, parsed_json)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              on conflict (feed_id, source_url) do nothing
            `,
            [
              subscription.feed_id,
              item.guid ?? null,
              sourceUrl,
              item.title ?? "Untitled item",
              item.contentSnippet ?? null,
              item.content ?? null,
              item.enclosure?.url ?? null,
              item.pubDate ? new Date(item.pubDate).toISOString() : null,
              JSON.stringify(item),
            ],
          );
          itemCount += 1;
        }

        await client.query("update site_rss_subscriptions set last_polled_at = now() where id = $1", [subscription.subscription_id]);
      });
    } catch {
      continue;
    }
  }

  return { subscriptions: subscriptions.rowCount, itemCount };
}

async function handleRssRetentionCleanup() {
  const result = await query(
    `
      delete from rss_items
      where created_at < now() - interval '30 days'
        and id not in (select distinct source_rss_item_id from content_items where source_rss_item_id is not null)
    `,
  );

  return { deleted: result.rowCount ?? 0 };
}

async function handleNewsCandidateSelect(siteId?: string) {
  const result = await query<{
    site_id: string;
    rss_item_id: string;
    source_url: string;
    rss_title: string;
    rss_summary: string | null;
    remaining_slots: number;
  }>(`
    with site_slots as (
      select
        s.id as site_id,
        count(distinct sub.id) filter (where sub.active = true)::int as feed_count,
        greatest(
          s.news_per_day - count(distinct ci.id) filter (
            where ci.kind = 'news'
              and ci.created_at >= now() - interval '24 hours'
              and ci.status in ('queued', 'running', 'ready', 'published')
          ),
          0
        )::int as remaining_slots
      from sites s
      join site_settings ss on ss.site_id = s.id
      join site_setup su on su.site_id = s.id
      left join site_rss_subscriptions sub on sub.site_id = s.id
      left join content_items ci on ci.site_id = s.id
      where coalesce(su.setup_state, 'needs_setup') = 'ready'
        and coalesce(su.credentials_test_state, 'untested') = 'passed'
        and coalesce(ss.allow_news, false) = true
        and ($1::uuid is null or s.id = $1::uuid)
        and exists (
          select 1
          from site_authors sa
          where sa.site_id = s.id
            and sa.active = true
            and sa.wp_author_id is not null
        )
        and exists (
          select 1
          from site_categories sc
          where sc.site_id = s.id
            and sc.active = true
            and sc.wp_category_id is not null
        )
      group by s.id, s.news_per_day
    ),
    candidates as (
      select
        sub.site_id,
        ri.id as rss_item_id,
        ri.source_url,
        ri.title as rss_title,
        ri.summary as rss_summary,
        row_number() over (partition by sub.site_id order by coalesce(ri.published_at, ri.created_at) desc) as rn,
        slots.remaining_slots
      from site_rss_subscriptions sub
      join site_slots slots on slots.site_id = sub.site_id
      join rss_items ri on ri.feed_id = sub.feed_id
      left join content_items ci on ci.site_id = sub.site_id and ci.source_rss_item_id = ri.id
      where sub.active = true
        and slots.feed_count > 0
        and slots.remaining_slots > 0
        and ci.id is null
    )
    select site_id, rss_item_id, source_url, rss_title, rss_summary, remaining_slots
    from candidates
    where rn <= greatest(remaining_slots * 3, 10)
  `, [siteId ?? null]);

  // Group candidates by site, then use LLM to pick the best items per site
  const siteGroups = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const group = siteGroups.get(row.site_id) ?? [];
    group.push(row);
    siteGroups.set(row.site_id, group);
  }

  let queued = 0;
  for (const [groupSiteId, candidates] of siteGroups) {
    const slotsNeeded = candidates[0].remaining_slots;

    // If we have more candidates than slots, use LLM to pick the best ones
    let selectedItems = candidates;
    if (candidates.length > slotsNeeded) {
      const siteProfile = await query<{ niche_summary: string | null; audience_summary: string | null }>(
        "select niche_summary, audience_summary from site_profiles where site_id = $1",
        [groupSiteId],
      );
      const niche = siteProfile.rows[0]?.niche_summary ?? "";
      const audience = siteProfile.rows[0]?.audience_summary ?? "";

      const candidateList = candidates.map((c, i) =>
        `${i + 1}. [${c.rss_title}] ${c.rss_summary ?? ""}`.slice(0, 200),
      ).join("\n");

      const selection = await generateJson(
        `Select the ${slotsNeeded} best news items for this site's audience.

Site niche: ${niche}
Target audience: ${audience}

Available news items:
${candidateList}

Pick the items that are most relevant, newsworthy, and valuable for the target audience. Prefer items that:
- Are directly relevant to the site's niche
- Have significant news value or practical implications
- Would engage the target audience

Return JSON: {"selected": [1, 3, 5]} — the numbers of the items you selected, in order of priority.`,
        { selected: Array.from({ length: Math.min(slotsNeeded, candidates.length) }, (_, i) => i + 1) },
      );

      const selectedIndices = (selection.selected as number[]).map((n) => n - 1).filter((i) => i >= 0 && i < candidates.length);
      selectedItems = selectedIndices.length > 0
        ? selectedIndices.slice(0, slotsNeeded).map((i) => candidates[i])
        : candidates.slice(0, slotsNeeded);
    } else {
      selectedItems = candidates.slice(0, slotsNeeded);
    }

    for (const row of selectedItems) {
      const authorId = await selectAuthorForSite(row.site_id);
      const categoryId = await selectActiveCategoryForSite(row.site_id);

      if (!authorId || !categoryId) {
        continue;
      }

      const insert = await query<{ id: string }>(
        `
          insert into content_items (site_id, kind, stage, status, source_rss_item_id, source_url, author_id, category_id)
          values ($1, 'news', 'research', 'queued', $2, $3, $4, $5)
          returning id
        `,
        [row.site_id, row.rss_item_id, row.source_url, authorId, categoryId],
      );

      await enqueueJob("news.rewrite", { contentItemId: insert.rows[0].id }, "content", insert.rows[0].id);
      queued += 1;

      // Throttle: stagger news article creation
      if (selectedItems.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  return { queued };
}

async function handleNewsRewrite(contentItemId: string) {
  const item = await query<{
    id: string;
    site_id: string;
    site_name: string;
    rss_title: string;
    rss_summary: string | null;
    source_url: string;
    tone_guide: string | null;
    audience_summary: string | null;
    niche_summary: string | null;
  }>(`
    select
      ci.id,
      ci.site_id,
      s.name as site_name,
      ri.title as rss_title,
      ri.summary as rss_summary,
      ri.source_url,
      sp.tone_guide,
      sp.audience_summary,
      sp.niche_summary
    from content_items ci
    join sites s on s.id = ci.site_id
    join rss_items ri on ri.id = ci.source_rss_item_id
    left join site_profiles sp on sp.site_id = s.id
    where ci.id = $1
  `, [contentItemId]);

  const row = item.rows[0];
  if (!row) {
    throw new Error(`News content ${contentItemId} not found`);
  }

  // Step D4: Read source article (scrape the full source page)
  const sourceContent = await fetchReadableText(row.source_url);
  const sourceText = sourceContent.text || row.rss_summary || "";

  // Step D5: Decide rewrite angle
  const angleDecision = await generateJson(
    `Decide how to reframe this news story for the target site's audience.

Source article title: ${row.rss_title}
Source article summary: ${row.rss_summary ?? ""}
Source article content (excerpt): ${sourceText.slice(0, 3000)}

Target site: ${row.site_name}
Site niche: ${row.niche_summary ?? row.site_name}
Target audience: ${row.audience_summary ?? "general readers"}

Return JSON with:
- angle: How to reframe this story for the target audience (e.g., "practical implications for small business owners", "what this means for beginners")
- keyFacts: Array of 3-5 key facts to preserve from the source
- whyItMatters: One sentence on why this matters to the target audience`,
    {
      angle: `How ${row.rss_title} impacts ${row.niche_summary ?? "the industry"}`,
      keyFacts: [row.rss_title],
      whyItMatters: "This development is relevant to the site's audience.",
    },
  );

  // Step D6: Rewrite article with site voice and full source context using 6-step methodology
  const article = await generateArticle(
    `Rewrite this news story for ${row.site_name} as an original news article.

SOURCE MATERIAL:
Title: ${row.rss_title}
Content: ${sourceText.slice(0, 4000)}
Source URL: ${row.source_url}

REWRITE CONTEXT:
Angle: ${typeof angleDecision.angle === "string" ? angleDecision.angle : "General news coverage"}
Key facts to preserve: ${JSON.stringify(angleDecision.keyFacts)}
Why it matters: ${typeof angleDecision.whyItMatters === "string" ? angleDecision.whyItMatters : ""}
Target site: ${row.site_name}
Site niche: ${row.niche_summary ?? row.site_name}
Target audience: ${row.audience_summary ?? "general readers"}
Site-specific voice: ${row.tone_guide ?? "warm, conversational, informative"}

${BASE_WRITING_STYLE}

REWRITE METHODOLOGY — follow these steps:

Step 1: Pinpoint essential details to preserve:
- Names of people, groups, or entities involved
- Dates, locations, and timelines
- Key numbers, data points, or statistics
- The central narrative
- Direct quotes and the full name of the person being quoted

Step 2: Rephrase everything EXCEPT quotes, names, numbers, and factual details.
- Restructure sentences and blend ideas in new ways
- Avoid distinctive phrases tied to the source
- Always include direct quotes with proper attribution

Step 3: Rearrange the flow.
- Present information in a different sequence from the original
- Start with a fresh perspective or angle
- Consider starting with the outcome and working backward

Step 4: Write in the site's tone of voice. Use the rewrite angle to shape the framing.

Step 5: Hook and hold the reader.
- Open with an attention-grabbing introduction
- Use active, vivid language
- Add relatable context that makes the story resonate for the target audience
- Keep the narrative flowing smoothly

Step 6: Include a "why this matters" paragraph for the target audience.

RULES:
- The rewritten article must NOT be traceable back to the original source's exact phrasing
- Retain ALL essential details and facts
- Match approximately the word count of the source content
- Every quote must include the full name of the person quoted
- Make it high-quality writing that captivates the reader`,
  );

  // Generate a proper title and excerpt
  const titleResult = await generateJson(
    `Generate a compelling news headline and excerpt for this article.

Original headline: ${row.rss_title}
Rewrite angle: ${typeof angleDecision.angle === "string" ? angleDecision.angle : ""}
Site: ${row.site_name}

HEADLINE RULES:
- Use strong, emotive words that grab attention and evoke curiosity or urgency
- Ensure accuracy — the headline must reflect the actual content
- Use active voice and present tense for immediacy
- Highlight the most surprising or significant aspect
- Optional: include numbers, data points, or a question
- Do NOT just prepend "News:" to the original title

EXCERPT RULES:
- Write a 20-word excerpt that ends with a cliffhanger
- Must be fun, engaging, and inviting
- Leave the reader wanting more

Return JSON with:
- title: Original, compelling headline
- excerpt: ~20-word hook ending with a cliffhanger`,
    {
      title: row.rss_title,
      excerpt: row.rss_summary ?? "",
    },
  );

  const title = String(titleResult.title || row.rss_title);
  const excerpt = String(titleResult.excerpt || article.slice(0, 160));

  // Generate a proper hero image prompt via LLM
  const heroImageResult = await generateJson(
    `Generate a single image prompt for a news article hero image.

Article title: ${title}
Article topic: ${row.niche_summary ?? row.site_name}
Article excerpt: ${article.slice(0, 500)}

IMAGE PROMPT RULES:
- Must feel like a REAL photo: slightly imperfect, not cinematic, not an illustration or 3D render.
- Describe what a camera sees: concrete subject, setting, key details, mood.
- NEVER use words like: illustration, icon, graphic, concept art, vector, 3D, digital art.
- Max 130 characters. No quotation marks or special characters.
- If people appear, at most 2 people described by role (e.g., "young professional"), no names.
- Should feel broader and iconic, hinting at the story's theme. Should work as a header image.
- Pick a varied style: candid smartphone photo, slightly grainy film photo, documentary style, or casual snapshot.
- Include a subtle imperfection: slightly imperfect focus, motion blur, digital noise, or older camera look.

Also generate a short alt text (under 80 characters).

Return JSON: {"prompt": "...", "altText": "..."}`,
    {
      prompt: `Candid photo related to ${row.niche_summary ?? title}, natural daylight, slightly out of focus, documentary style`,
      altText: title,
    },
  );

  const imagePlan = [
    {
      placementKey: "hero",
      role: "hero",
      altText: String(heroImageResult.altText ?? title).slice(0, 80),
      prompt: String(heroImageResult.prompt ?? `Candid photo of ${title} scene, natural light`).slice(0, 130),
    },
  ];

  await withTransaction(async (client) => {
    await client.query(
      `
        update content_items
        set title = $2,
            slug = $3,
            article_markdown = $4,
            excerpt = $5,
            stage = 'image_plan',
            status = 'ready',
            image_plan_json = $6
        where id = $1
      `,
      [contentItemId, title, slugify(title), article, excerpt, JSON.stringify(imagePlan)],
    );

    await client.query(
      `
        insert into content_assets (content_item_id, role, placement_key, prompt, alt_text, generation_status)
        values ($1, 'hero', 'hero', $2, $3, 'queued')
        on conflict do nothing
      `,
      [contentItemId, imagePlan[0].prompt, imagePlan[0].altText],
    );
  });

  await enqueueJob("content.image_generate", { contentItemId }, "content", contentItemId);
  return { contentItemId };
}

async function selectAuthorForSite(siteId: string): Promise<string | null> {
  // Pick author with lowest usage_count (round-robin) and immediately increment
  // so the NEXT call in the same batch picks a different author.
  const result = await query<{ id: string }>(
    `update site_authors
     set usage_count = usage_count + 1
     where id = (
       select id from site_authors
       where site_id = $1 and active = true and wp_author_id is not null
       order by usage_count asc, created_at asc
       limit 1
     )
     returning id`,
    [siteId],
  );
  return result.rows[0]?.id ?? null;
}

async function selectActiveCategoryForSite(siteId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `
      select id
      from site_categories
      where site_id = $1
        and active = true
        and wp_category_id is not null
      order by usage_count asc, created_at asc
      limit 1
    `,
    [siteId],
  );

  return result.rows[0]?.id ?? null;
}

async function handleBlogCandidateSelect(siteId?: string) {
  const siteSlots = await query<{
    site_id: string;
    remaining_slots: number;
    last_category_id: string | null;
    has_last_blog: boolean;
  }>(`
    select
      s.id as site_id,
      greatest(
        s.posts_per_day - count(ci.id) filter (
          where ci.kind = 'blog'
            and ci.created_at >= now() - interval '24 hours'
            and ci.status in ('queued', 'running', 'ready', 'published')
        ),
        0
      )::int as remaining_slots,
      (
        select recent.category_id
        from content_items recent
        where recent.site_id = s.id
          and recent.kind = 'blog'
          and recent.status in ('queued', 'running', 'ready', 'published')
        order by recent.created_at desc, recent.id desc
        limit 1
      ) as last_category_id,
      exists (
        select 1
        from content_items recent
        where recent.site_id = s.id
          and recent.kind = 'blog'
          and recent.status in ('queued', 'running', 'ready', 'published')
      ) as has_last_blog
    from sites s
    join site_settings ss on ss.site_id = s.id
    join site_setup su on su.site_id = s.id
    left join content_items ci on ci.site_id = s.id
    where coalesce(su.setup_state, 'needs_setup') = 'ready'
      and coalesce(su.credentials_test_state, 'untested') = 'passed'
      and coalesce(ss.allow_blog, false) = true
      and ($1::uuid is null or s.id = $1::uuid)
      and exists (
        select 1
        from site_authors sa
        where sa.site_id = s.id
          and sa.active = true
          and sa.wp_author_id is not null
      )
      and exists (
        select 1
        from site_categories sc
        where sc.site_id = s.id
          and sc.active = true
          and sc.wp_category_id is not null
      )
    group by s.id, s.posts_per_day
    having greatest(
      s.posts_per_day - count(ci.id) filter (
        where ci.kind = 'blog'
          and ci.created_at >= now() - interval '24 hours'
          and ci.status in ('queued', 'running', 'ready', 'published')
      ),
      0
    ) > 0
  `, [siteId ?? null]);

  let queued = 0;
  for (const site of siteSlots.rows) {
    const candidateLimit = Math.max(100, site.remaining_slots * 20);
    const candidates = await query<{
      keyword_id: string;
      keyword_category_id: string | null;
      created_at: Date;
      recent_category_count: number;
      category_usage_count: number;
    }>(
      `
        with category_usage as (
          select
            ci.category_id,
            count(*)::int as recent_count
          from content_items ci
          where ci.site_id = $1
            and ci.kind = 'blog'
            and ci.created_at >= now() - interval '7 days'
            and ci.status in ('queued', 'running', 'ready', 'published')
          group by ci.category_id
        )
        select
          k.id as keyword_id,
          k.category_id as keyword_category_id,
          k.created_at,
          coalesce(cu.recent_count, 0)::int as recent_category_count,
          coalesce(sc.usage_count, 0)::int as category_usage_count
        from keyword_candidates k
        left join content_items existing
          on existing.site_id = k.site_id
          and existing.source_keyword_id = k.id
          and existing.kind = 'blog'
          and existing.status in ('queued', 'running', 'ready')
        left join category_usage cu on cu.category_id is not distinct from k.category_id
        left join site_categories sc on sc.id = k.category_id
        where k.site_id = $1
          and k.used = false
          and k.category_id is not null
          and coalesce(sc.active, false) = true
          and existing.id is null
        order by k.created_at asc
        limit $2
      `,
      [site.site_id, candidateLimit],
    );

    const selectedItems = selectKeywordCandidatesForSlots(
      candidates.rows.map<KeywordSelectionCandidate>((candidate) => ({
        keywordId: candidate.keyword_id,
        categoryId: candidate.keyword_category_id,
        createdAt: candidate.created_at,
        recentCategoryCount: candidate.recent_category_count,
        categoryUsageCount: candidate.category_usage_count,
      })),
      site.remaining_slots,
      site.has_last_blog ? site.last_category_id : undefined,
    );

    for (const row of selectedItems) {
      const authorId = await selectAuthorForSite(site.site_id);
      if (!authorId) {
        continue;
      }

      const insert = await query<{ id: string }>(
        `
          insert into content_items (site_id, kind, stage, status, source_keyword_id, category_id, author_id)
          values ($1, 'blog', 'research', 'queued', $2, $3, $4)
          returning id
        `,
        [site.site_id, row.keywordId, row.categoryId, authorId],
      );
      await query("update keyword_candidates set used = true where id = $1", [row.keywordId]);
      if (row.categoryId) {
        await query("update site_categories set usage_count = usage_count + 1 where id = $1", [row.categoryId]);
      }
      await enqueueJob("blog.seo_brief_generate", { contentItemId: insert.rows[0].id }, "content", insert.rows[0].id);
      queued += 1;

      if (selectedItems.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  return { queued };
}

async function handleBlogSeoBriefGenerate(contentItemId: string) {
  const result = await query<{
    site_name: string;
    keyword: string;
    niche_summary: string | null;
    tone_guide: string | null;
    audience_summary: string | null;
    avatar_map_json: unknown;
    location_code: string | null;
    language_code: string | null;
  }>(`
    select s.name as site_name, k.keyword, sp.niche_summary, sp.tone_guide, sp.audience_summary, sp.avatar_map_json,
           s.location_code, s.language_code
    from content_items ci
    join sites s on s.id = ci.site_id
    join keyword_candidates k on k.id = ci.source_keyword_id
    left join site_profiles sp on sp.site_id = s.id
    where ci.id = $1
  `, [contentItemId]);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Blog content ${contentItemId} not found`);
  }

  const locationCode = Number(row.location_code) || 2840;
  const languageCode = row.language_code || "en";

  let dataForSeoEvidence: unknown = null;
  try {
    dataForSeoEvidence = await dataForSeoPost("/serp/google/organic/live/advanced", [
      {
        keyword: row.keyword,
        location_code: locationCode,
        language_code: languageCode,
        device: "desktop",
        depth: 10,
      },
    ]);
  } catch {
    dataForSeoEvidence = null;
  }

  // Extract top 5 SERP results
  let serpSummary = "";
  const serpData = dataForSeoEvidence as { tasks?: Array<{ result?: Array<{ items?: Array<{ type?: string; title?: string; url?: string; description?: string }> }> }> } | null;
  const organicResults = serpData?.tasks?.[0]?.result?.[0]?.items?.filter((i) => i.type === "organic").slice(0, 5) ?? [];
  if (organicResults.length > 0) {
    serpSummary = organicResults.map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${r.description ?? ""}`).join("\n");
  }

  // Scrape top 3 competitor pages for deeper content analysis
  let competitorAnalysis = "";
  const topUrls = organicResults.slice(0, 3).map((r) => r.url).filter(Boolean) as string[];
  if (topUrls.length > 0) {
    const scraped = await Promise.all(topUrls.map((url) => scrapePageContent(url).catch(() => null)));
    const validPages = scraped.filter(Boolean);
    if (validPages.length > 0) {
      competitorAnalysis = validPages.map((page, i) => {
        const p = page!;
        return `Competitor ${i + 1} (${topUrls[i]}):
  Word count: ${p.wordCount}
  Headings: ${p.headings.slice(0, 8).join(", ")}
  Content excerpt: ${p.text.slice(0, 800)}`;
      }).join("\n\n");
    }
  }

  const brief = await generateJson(
    `Create a comprehensive SEO brief for a blog article.

Site: ${row.site_name}
Niche: ${row.niche_summary ?? row.site_name}
Target audience: ${row.audience_summary ?? "general readers"}
Tone: ${row.tone_guide ?? "clear and helpful"}
Keyword: ${row.keyword}

Top SERP competitors:
${serpSummary || "No SERP data available"}

${competitorAnalysis ? `Competitor content analysis:\n${competitorAnalysis}` : ""}

Based on the SERP results and competitor content, return JSON with:
- audience: Who this article is specifically written for
- intent: The search intent (informational, transactional, navigational, commercial)
- angle: The unique angle or perspective this article should take vs competitors. The first section must always answer the search intent in a clear and definitive way.
- mustCoverSubtopics: Array of 4-6 specific subtopics the article must address to be comprehensive. Include specific data points, dates, numbers, facts, steps, or instructions where relevant.
- faqQuestions: Array of exactly 3 frequently asked questions about this topic
- outlineHints: Array of suggested H2 section headings. The first H2 should directly answer the search intent. Include a mix of explanatory, how-to, comparison, and practical sections.
- titleIdeas: Array of 3-5 title options. Rules: max 8 words or 60 characters each. Must incorporate the keyword naturally. Use unique, engaging language. Keep it simple — NEVER use words like "guide", "explained", "unraveled", "decoded", "unpacked", "unveiling", "mastering", "ultimate".

IMPORTANT: The angle must be purely informational and helpful. Do NOT suggest affiliate content, product recommendations, tool suggestions, or "polish." This is an informational article, not a review or sales page.`,
    {
      audience: "site readers",
      intent: "informational",
      angle: `Practical guide to ${row.keyword}`,
      mustCoverSubtopics: ["Definition and overview", "Key benefits", "Step-by-step process", "Common mistakes"],
      faqQuestions: [`What is ${row.keyword}?`, `How does ${row.keyword} work?`],
      outlineHints: ["What it is", "Why it matters", "How to do it", "Common mistakes", "FAQ"],
      titleIdeas: [`${row.keyword}: Complete Guide`, `How to approach ${row.keyword}`],
    },
  );

  await query(
    `
      update content_items
      set seo_brief_json = $2,
          stage = 'outline',
          status = 'ready'
      where id = $1
    `,
    [contentItemId, JSON.stringify(brief)],
  );

  await enqueueJob("blog.outline_generate", { contentItemId }, "content", contentItemId);
  return { contentItemId };
}

async function handleBlogOutlineGenerate(contentItemId: string) {
  const result = await query<{
    site_name: string;
    keyword: string;
    seo_brief_json: Record<string, unknown>;
    tone_guide: string | null;
  }>(`
    select s.name as site_name, k.keyword, ci.seo_brief_json, sp.tone_guide
    from content_items ci
    join sites s on s.id = ci.site_id
    join keyword_candidates k on k.id = ci.source_keyword_id
    left join site_profiles sp on sp.site_id = s.id
    where ci.id = $1
  `, [contentItemId]);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Blog content ${contentItemId} not found`);
  }

  const brief = row.seo_brief_json ?? {};
  const faqQuestions = Array.isArray(brief.faqQuestions) ? brief.faqQuestions : [];
  const mustCover = Array.isArray(brief.mustCoverSubtopics) ? brief.mustCoverSubtopics : [];

  const outline = await generateJson(
    `Create a detailed structured JSON article outline for a blog post.

Site: ${row.site_name}
Keyword: ${row.keyword}
Tone: ${row.tone_guide ?? "clear and helpful"}
SEO brief: ${JSON.stringify(brief)}

OUTLINE RULES:
1. The first H2 section MUST directly answer the search intent clearly and definitively. Its heading should signal to the reader that their question will be answered here.
2. Sections 2+ are supporting sections that deepen understanding of the topic.
3. Create 5-7 H2 sections total (not counting Introduction, FAQ, and Final Words). This is a hard limit. Combine related ideas into fewer, richer sections rather than creating many thin sections.
4. NEVER add H3 sub-sections to more than 40% of all H2 sections. Most sections should be flat (no H3s). Only add H3s where the content genuinely requires sub-structure (e.g., step-by-step instructions, comparisons).
5. Maximum 2 sections in the entire outline should use lists or tables. For those 2 sections, note it in the goal. All other sections must be flowing prose paragraphs with NO lists.
6. Include specific data in the outline: dates, numbers, facts, instructions, steps from reliable sources. Especially for sections with "How", "When", "Steps" in the heading.
7. Must cover these subtopics: ${mustCover.join(", ") || "use your judgment"}
8. Include a "Final Words" conclusion section (H2: "Final Words") immediately before the FAQ.
9. End with a FAQ section containing exactly 3 questions (pick the 3 most important from: ${faqQuestions.join(", ") || "common questions about the topic"}). FAQ must be the last section.

Return JSON in the form:
{"sections":[
  {"heading":"Introduction","goal":"Hook the reader, transition to body, present thesis. 70-100 words.","type":"intro","subsections":[]},
  {"heading":"H2 heading","goal":"What this section covers. Note if it should use lists/tables.","type":"body","subsections":[]},
  {"heading":"H2 with subtopics","goal":"...","type":"body","subsections":[{"heading":"H3 heading","goal":"..."}]},
  {"heading":"Final Words","goal":"70-100 word recap. End on a positive note.","type":"conclusion","subsections":[]},
  {"heading":"FAQ","goal":"Answer common questions concisely. This must be the final section.","type":"faq","subsections":[{"heading":"question?","goal":"answer direction"}]}
]}`,
    {
      sections: [
        { heading: "Introduction", goal: `Introduce ${row.keyword} and why it matters.`, type: "intro", subsections: [] },
        { heading: `What is ${row.keyword}?`, goal: "Define the topic clearly.", type: "body", subsections: [{ heading: "Key concepts", goal: "Explain fundamentals" }] },
        { heading: `Why ${row.keyword} matters`, goal: "Explain the importance and context.", type: "body", subsections: [{ heading: "Benefits", goal: "List key benefits" }] },
        { heading: `How to approach ${row.keyword}`, goal: "Give step-by-step guidance.", type: "body", subsections: [{ heading: "Step 1", goal: "First step" }] },
        { heading: "Common mistakes", goal: "Warn about pitfalls.", type: "body", subsections: [] },
        { heading: "Final Words", goal: "70-100 word recap. End on a positive note.", type: "conclusion", subsections: [] },
        { heading: "FAQ", goal: "Answer common follow-up questions.", type: "faq", subsections: faqQuestions.map((q: string) => ({ heading: q, goal: "Answer concisely" })) },
      ],
    },
  );

  const sections = orderFinalWordsBeforeFaq((outline.sections ?? []) as Array<Record<string, unknown>>);

  await withTransaction(async (client) => {
    await client.query(
      `
        update content_items
        set outline_json = $2,
            stage = 'draft',
            status = 'ready'
        where id = $1
      `,
      [contentItemId, JSON.stringify(sections)],
    );

    await client.query("delete from content_sections where content_item_id = $1", [contentItemId]);
    let index = 0;
    for (const section of sections) {
      index += 1;
      await client.query(
        `
          insert into content_sections (content_item_id, order_index, section_key, heading, goal, status)
          values ($1, $2, $3, $4, $5, 'queued')
        `,
        [contentItemId, index, `section-${index}`, String(section.heading ?? `Section ${index}`), String(section.goal ?? "")],
      );
    }
  });

  await enqueueJob("blog.outline_review", { contentItemId }, "content", contentItemId);
  return { sections: sections.length };
}

async function handleBlogDraftGenerate(contentItemId: string) {
  const result = await query<{
    site_name: string;
    keyword: string;
    outline_json: Array<Record<string, unknown>>;
    seo_brief_json: Record<string, unknown> | null;
    image_density_pct: number;
    tone_guide: string | null;
    audience_summary: string | null;
    niche_summary: string | null;
  }>(`
    select
      s.name as site_name,
      k.keyword,
      ci.outline_json,
      ci.seo_brief_json,
      coalesce(ss.image_density_pct, 100) as image_density_pct,
      sp.tone_guide,
      sp.audience_summary,
      sp.niche_summary
    from content_items ci
    join sites s on s.id = ci.site_id
    join keyword_candidates k on k.id = ci.source_keyword_id
    left join site_settings ss on ss.site_id = s.id
    left join site_profiles sp on sp.site_id = s.id
    where ci.id = $1
  `, [contentItemId]);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Blog content ${contentItemId} not found`);
  }

  const brief = row.seo_brief_json ?? {};
  const titleIdeas = Array.isArray(brief.titleIdeas) ? brief.titleIdeas as string[] : [];

  const article = await generateArticle(
    `Write a complete blog article in markdown for ${row.site_name}.

Primary keyword: ${row.keyword}
Target audience: ${row.audience_summary ?? "general readers"}
Site niche: ${row.niche_summary ?? row.site_name}
Site-specific voice: ${row.tone_guide ?? "warm, conversational, helpful"}
SEO brief: ${JSON.stringify(brief)}
Outline JSON: ${JSON.stringify(row.outline_json)}

${BASE_WRITING_STYLE}

WRITING RULES:

STRUCTURE:
- Follow the outline structure exactly. Use ## for H2 headings and ### for H3 headings.
- The FIRST H2 heading must NOT repeat the article title. It must be a distinct heading that directly answers the search intent.
- The ## Final Words section must come immediately before ## FAQ. The ## FAQ section must be the last section.
- Only add H3 sub-sections where the outline explicitly specifies them. Do NOT invent additional H3s. Most H2 sections should be FLAT (no H3s).
- Use bullet-point lists ONLY where the outline goal explicitly calls for them. Maximum 2-3 lists in the entire article. Do NOT use lists as a crutch.

INTRODUCTION (first section, no heading):
- Start with a hook: a question, a surprising fact, a short story, or an analogy. Do NOT start by listing meanings or definitions.
- Do NOT reveal all the article's key points in the intro. Tease, don't summarize.
- Transition to the body with a clear thesis about what the reader will learn.
- Length: 70-100 words. Do NOT start with "In today's..." or any cliché opener.

BODY SECTIONS:
- The first H2 must directly answer the search intent, give the reader what they came for immediately.
- Each section must provide NEW information. NEVER repeat what was said in another section or in the intro.
- Include specific data: dates, numbers, facts, step-by-step instructions where relevant.
- Write with authority. Use concrete examples, not vague statements.
- Address the reader directly ("you") where appropriate.
- Vary paragraph length. Mix short punchy sentences with longer explanatory ones.
- Each H2 section should be 150-300 words. Do not write overly long sections.

CONCLUSION:
- Use the heading ## Final Words
- Length: 70-100 words. Break into short chunks for readability.
- Start "in the action", a quick recap of key takeaways. NEVER start with "Congratulations", "Looking back", "In conclusion", "In reflection", or "In summary".
- End on a positive, forward-looking note.
- No greetings or calling out the reader by name/avatar.
- Do NOT end with "Namaste", "Blessings", "Peace", or any sign-off word.

FAQ SECTION:
- Use ## FAQ as the heading.
- Include exactly 3 questions. No more, no fewer.
- Each question as ### with a concise, direct answer (2-3 sentences max).
- Do not add any section after FAQ.

KEYWORD USAGE:
- Include "${row.keyword}" naturally in the introduction, 2-3 H2 headings, and conclusion.
- Do NOT force the keyword where it doesn't fit naturally. Never keyword-stuff.

CRITICAL STYLE RULES:
- Write in the site's tone of voice.
- No filler words, no fluff, no generic statements that could apply to any topic.
- Every sentence must add value. If a sentence could be removed without losing information, remove it.
- Do NOT write "Oops, let me rephrase" or any fake self-corrections more than ONCE in the entire article. One is fine for human feel. More is annoying.
- Do NOT add random filler phrases like "Softly glowing", "Namaste", "True story", "Just saying" at the end of paragraphs.
- Natural imperfections should be SUBTLE, not performative. One small aside or rhetorical question per 3-4 paragraphs is enough.
- Do NOT use words/phrases: "dive in", "dive into", "it's important to note", "in today's fast-paced world", "game-changer", "unlock", "harness", "leverage", "navigate the world of", "the landscape of", "realm of", "let's explore", "without further ado".`,
  );

  const articleMarkdown = enforceFinalWordsBeforeFaq(article);

  // Use a title from SEO brief titleIdeas (first one that fits the rules)
  const validTitle = titleIdeas.find((t: string) => t.length <= 60 && t.split(/\s+/).length <= 8);
  const title = validTitle ?? titleIdeas[0] ?? row.keyword;

  // Generate a proper excerpt — 20-word cliffhanger that pulls the reader in
  const excerptResult = await generateJson(
    `Write a 20-word excerpt for this blog article. The excerpt must:
- Be fun, engaging, and inviting
- End with a cliffhanger that leaves the reader wanting more
- Pull the reader into reading the full article
- NOT be a dry summary

Article title: ${title}
Keyword: ${row.keyword}
Article intro: ${articleMarkdown.split("\n\n").slice(0, 2).join(" ").slice(0, 500)}

Return JSON with: excerpt (string, exactly ~20 words, ends with a hook)`,
    { excerpt: articleMarkdown.replace(/[#*_\[\]]/g, "").trim().slice(0, 160) },
  );
  const excerpt = String(excerptResult.excerpt ?? "").slice(0, 300);

  const imagePlan = await buildBlogImagePlan(title, row.keyword, articleMarkdown, row.image_density_pct);

  await query(
    `
      update content_items
      set title = $2,
          slug = $3,
          article_markdown = $4,
          excerpt = $5,
          image_plan_json = $6,
          stage = 'image_plan',
          status = 'ready'
      where id = $1
    `,
    [contentItemId, title, slugify(title), articleMarkdown, excerpt, JSON.stringify(imagePlan)],
  );

  await enqueueJob("blog.draft_review", { contentItemId }, "content", contentItemId);
  return { contentItemId };
}

async function handleBlogOutlineReview(contentItemId: string) {
  const result = await query<{
    keyword: string;
    outline_json: Array<Record<string, unknown>>;
    seo_brief_json: Record<string, unknown> | null;
    tone_guide: string | null;
  }>(`
    select k.keyword, ci.outline_json, ci.seo_brief_json, sp.tone_guide
    from content_items ci
    join keyword_candidates k on k.id = ci.source_keyword_id
    left join site_profiles sp on sp.site_id = ci.site_id
    where ci.id = $1
  `, [contentItemId]);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Blog content ${contentItemId} not found`);
  }

  const review = await generateJson(
    `Review this article outline for quality and completeness.

Keyword: ${row.keyword}
Tone: ${row.tone_guide ?? "clear and helpful"}
SEO brief: ${JSON.stringify(row.seo_brief_json)}
Current outline: ${JSON.stringify(row.outline_json)}

Evaluate:
1. Does the outline match the target keyword and search intent?
2. Are all must-cover subtopics from the SEO brief addressed?
3. Is the tone appropriate for the site?
4. Is the structure logical and comprehensive?

Return JSON:
- approved: boolean (true if the outline is good enough, false if it needs revision)
- feedback: string (brief explanation of any issues)
- revisedSections: If not approved, provide the corrected sections array in the same format as the input. If approved, set to null.`,
    {
      approved: true,
      feedback: "Outline covers the keyword topic comprehensively.",
      revisedSections: null,
    },
  );

  if (!review.approved && review.revisedSections) {
    // Apply the revised outline
    const sections = orderFinalWordsBeforeFaq(review.revisedSections as Array<Record<string, unknown>>);
    await withTransaction(async (client) => {
      await client.query(
        "update content_items set outline_json = $2 where id = $1",
        [contentItemId, JSON.stringify(sections)],
      );

      await client.query("delete from content_sections where content_item_id = $1", [contentItemId]);
      let index = 0;
      for (const section of sections) {
        index += 1;
        await client.query(
          "insert into content_sections (content_item_id, order_index, section_key, heading, goal, status) values ($1, $2, $3, $4, $5, 'queued')",
          [contentItemId, index, `section-${index}`, String(section.heading ?? `Section ${index}`), String(section.goal ?? "")],
        );
      }
    });
  }

  await enqueueJob("blog.draft_generate", { contentItemId }, "content", contentItemId);
  return { approved: review.approved, feedback: review.feedback };
}

async function handleBlogDraftReview(contentItemId: string) {
  const result = await query<{
    keyword: string;
    article_markdown: string | null;
    seo_brief_json: Record<string, unknown> | null;
    outline_json: Array<Record<string, unknown>>;
    tone_guide: string | null;
  }>(`
    select k.keyword, ci.article_markdown, ci.seo_brief_json, ci.outline_json, sp.tone_guide
    from content_items ci
    join keyword_candidates k on k.id = ci.source_keyword_id
    left join site_profiles sp on sp.site_id = ci.site_id
    where ci.id = $1
  `, [contentItemId]);

  const row = result.rows[0];
  if (!row || !row.article_markdown) {
    throw new Error(`Blog content ${contentItemId} not found or has no article`);
  }

  const review = await generateJson(
    `Review this blog article for quality, accuracy, and alignment with the SEO brief.

Keyword: ${row.keyword}
Tone: ${row.tone_guide ?? "clear and helpful"}
SEO brief: ${JSON.stringify(row.seo_brief_json)}
Outline: ${JSON.stringify(row.outline_json)}

Article (markdown):
${row.article_markdown.slice(0, 6000)}

Evaluate:
1. Does the article match the search intent from the SEO brief?
2. Is the keyword used naturally throughout?
3. Does it match the specified tone of voice?
4. Is the content factually consistent and specific (not generic)?
5. Are there any missing topics from the outline?
6. Is it readable and well-structured?

Return JSON:
- approved: boolean
- feedback: string (brief explanation)
- issues: array of specific issues found (empty if approved)`,
    {
      approved: true,
      feedback: "Article is well-written and aligns with the SEO brief.",
      issues: [],
    },
  );

  // Log review result but always proceed (single review pass, no infinite loop)

  await enqueueJob("content.image_generate", { contentItemId }, "content", contentItemId);
  return { approved: review.approved, feedback: review.feedback };
}

async function handleContentImageGenerate(contentItemId: string) {
  const content = await query<{
    id: string;
    title: string | null;
    image_plan_json: Array<Record<string, unknown>>;
  }>(
    `
      select id, title, image_plan_json
      from content_items
      where id = $1
    `,
    [contentItemId],
  );

  const row = content.rows[0];
  if (!row) {
    throw new Error(`Content ${contentItemId} not found`);
  }

  // Materialize content_assets from the image plan if not already done
  const existingAssets = await query<{ id: string }>(
    "select id from content_assets where content_item_id = $1 limit 1",
    [contentItemId],
  );

  if (!existingAssets.rowCount) {
    const plan = (row.image_plan_json ?? []) as Array<Record<string, unknown>>;
    await withTransaction(async (client) => {
      for (const asset of plan) {
        await client.query(
          `
            insert into content_assets (content_item_id, role, placement_key, prompt, alt_text, generation_status)
            values ($1, $2, $3, $4, $5, 'queued')
          `,
          [
            contentItemId,
            String(asset.role ?? "hero"),
            String(asset.placementKey ?? "hero"),
            String(asset.prompt ?? `${row.title ?? "Article"} hero image`),
            String(asset.altText ?? `${row.title ?? "Article"} image`),
          ],
        );
      }
    });
  }

  // Get all queued assets
  const assets = await query<{
    id: string;
    prompt: string | null;
    generation_status: string;
    public_url: string | null;
  }>(
    "select id, prompt, generation_status, public_url from content_assets where content_item_id = $1 order by created_at asc",
    [contentItemId],
  );

  const queuedAssets = assets.rows.filter((a) => a.generation_status === "queued");

  if (!queuedAssets.length) {
    // All assets already processed - move to publish.
    const readyImages = assets.rows.filter((asset) => asset.generation_status === "ready" && asset.public_url);
    if (assets.rows.length && !readyImages.length) {
      await query("update content_items set stage = 'image_generation', status = 'failed' where id = $1", [contentItemId]);
      return { skipped: true, reason: "No ready generated images are available for publishing." };
    }

    await query("update content_items set stage = 'publish_pending', status = 'ready' where id = $1", [contentItemId]);
    await enqueueJob("wordpress.publish", { contentItemId }, "content", contentItemId);
    return { skipped: true };
  }

  // Generate images directly (one at a time, not via Batch API)
  await query("update content_items set stage = 'image_generation', status = 'running' where id = $1", [contentItemId]);

  const imageResults = await generateImages(
    queuedAssets.map((asset) => ({
      assetId: asset.id,
      prompt: asset.prompt ?? row.title ?? "Editorial illustration",
    })),
  );

  let generated = 0;
  let failed = 0;

  await withTransaction(async (client) => {
    for (const result of imageResults) {
      if (result.imageUrl || result.imageBase64) {
        // Download and upload the image
        let imageBuffer: Buffer;
        let contentType = "image/png";

        if (result.imageUrl) {
          try {
            const imageResponse = await fetch(result.imageUrl);
            imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            contentType = imageResponse.headers.get("content-type") ?? "image/png";
          } catch {
            // URL fetch failed - try base64 or mark failed.
            if (result.imageBase64) {
              imageBuffer = Buffer.from(result.imageBase64, "base64");
            } else {
              await client.query("update content_assets set generation_status = 'failed' where id = $1", [result.assetId]);
              failed += 1;
              continue;
            }
          }
        } else {
          imageBuffer = Buffer.from(result.imageBase64!, "base64");
        }

        const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
        const filePath = `content/${contentItemId}/${result.assetId}.${ext}`;
        const upload = await uploadAsset(filePath, imageBuffer, contentType);

        await client.query(
          "update content_assets set storage_path = $2, public_url = $3, generation_status = 'ready' where id = $1",
          [result.assetId, upload.path, upload.publicUrl],
        );
        generated += 1;
      } else if (result.error) {
        await client.query(
          `update content_assets set generation_status = 'failed',
           metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{error}', to_jsonb($2::text))
           where id = $1`,
          [result.assetId, result.error],
        );
        failed += 1;
      } else {
        await client.query(
          `update content_assets set generation_status = 'failed',
           metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{error}', to_jsonb($2::text))
           where id = $1`,
          [result.assetId, "Image generation returned no image"],
        );
        failed += 1;
      }
    }

    if (generated > 0) {
      await client.query("update content_items set stage = 'publish_pending', status = 'ready' where id = $1", [contentItemId]);
    } else {
      await client.query("update content_items set stage = 'image_generation', status = 'failed' where id = $1", [contentItemId]);
    }
  });

  if (!generated) {
    return { generated, failed, skippedPublish: true, reason: "No generated images were uploaded." };
  }

  await enqueueJob("wordpress.publish", { contentItemId }, "content", contentItemId);
  return { generated, failed };
}

async function handleWordPressPublish(contentItemId: string) {
  const result = await query<{
    id: string;
    site_id: string;
    title: string | null;
    slug: string | null;
    article_markdown: string | null;
    excerpt: string | null;
    kind: "blog" | "news";
    author_id: string | null;
    category_id: string | null;
    image_plan_json: Array<Record<string, unknown>> | null;
    publish_result_json: Record<string, unknown>;
  }>(
    `
      select ci.id, ci.site_id, ci.title, ci.slug, ci.article_markdown, ci.excerpt, ci.kind,
             ci.author_id, ci.category_id, ci.image_plan_json, ci.publish_result_json
      from content_items ci
      where ci.id = $1
    `,
    [contentItemId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Content ${contentItemId} not found`);
  }

  const site = await getSiteContext(row.site_id);
  if (!site) {
    throw new Error(`Site ${row.site_id} not found`);
  }

  const credentials = getWordPressCredentials(site);

  // Resolve WP author ID from site_authors
  let activeAuthorId = row.author_id;
  let wpAuthorId: number | undefined;
  if (activeAuthorId) {
    const authorResult = await query<{ wp_author_id: number }>(
      "select wp_author_id from site_authors where id = $1 and active = true",
      [activeAuthorId],
    );
    wpAuthorId = authorResult.rows[0]?.wp_author_id;
  }
  if (!wpAuthorId) {
    activeAuthorId = await selectAuthorForSite(row.site_id);
    if (activeAuthorId) {
      const fallbackAuthor = await query<{ wp_author_id: number }>(
        "select wp_author_id from site_authors where id = $1 and active = true",
        [activeAuthorId],
      );
      wpAuthorId = fallbackAuthor.rows[0]?.wp_author_id;
      if (wpAuthorId) {
        await query("update content_items set author_id = $2 where id = $1", [contentItemId, activeAuthorId]);
      }
    }
  }

  // Resolve WP category IDs from site_categories
  let activeCategoryId = row.category_id;
  let wpCategoryIds: number[] | undefined;
  if (activeCategoryId) {
    const catResult = await query<{ wp_category_id: number }>(
      "select wp_category_id from site_categories where id = $1 and active = true",
      [activeCategoryId],
    );
    if (catResult.rows[0]?.wp_category_id) {
      wpCategoryIds = [catResult.rows[0].wp_category_id];
    }
  }
  if (!wpCategoryIds?.length) {
    activeCategoryId = await selectActiveCategoryForSite(row.site_id);
    if (activeCategoryId) {
      const fallbackCategory = await query<{ wp_category_id: number }>(
        "select wp_category_id from site_categories where id = $1 and active = true",
        [activeCategoryId],
      );
      if (fallbackCategory.rows[0]?.wp_category_id) {
        wpCategoryIds = [fallbackCategory.rows[0].wp_category_id];
        await query("update content_items set category_id = $2 where id = $1", [contentItemId, activeCategoryId]);
      }
    }
  }

  let publishResult: Record<string, unknown>;

  if (!site.auto_post) {
    return {
      published: false,
      skipped: true,
      reason: "Auto posting is disabled for this site.",
    };
  }

  if (!credentials || site.setup_state !== "ready" || site.credentials_test_state !== "passed") {
    throw new Error("This site is not allowed to publish until setup is ready and WordPress credentials have passed testing.");
  }
  if (!wpAuthorId) {
    throw new Error("No active WordPress author is selected for this site.");
  }
  if (!wpCategoryIds?.length) {
    throw new Error("No active WordPress category is selected for this site.");
  }

  // Upload images to WordPress and collect media IDs
  let featuredMediaId: number | undefined;
  const assets = await query<{
    id: string;
    role: string;
    placement_key: string;
    public_url: string | null;
    alt_text: string | null;
    storage_path: string | null;
  }>(
    "select id, role, placement_key, public_url, alt_text, storage_path from content_assets where content_item_id = $1 and generation_status = 'ready' and (storage_path is not null or public_url is not null) order by created_at asc",
    [contentItemId],
  );

  const expectedImageCount = Array.isArray(row.image_plan_json) ? row.image_plan_json.length : 0;
  if (expectedImageCount > 0 && !assets.rowCount) {
    throw new Error("No ready generated images are available for WordPress publishing.");
  }

  const uploadedImages: ArticleImage[] = [];
  for (const asset of assets.rows) {
    if (!asset.storage_path && !asset.public_url) continue;
    try {
      const downloaded = asset.storage_path
        ? await downloadAsset(asset.storage_path)
        : await fetch(asset.public_url!).then(async (imageResponse) => {
            if (!imageResponse.ok) {
              throw new Error(`Image fetch failed with ${imageResponse.status}`);
            }

            return {
              body: Buffer.from(await imageResponse.arrayBuffer()),
              contentType: imageResponse.headers.get("content-type") ?? "image/png",
            };
          });
      const imageBuffer = downloaded.body;
      const contentType = downloaded.contentType;
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const fileName = `${asset.id}.${ext}`;

      const wpMedia = await uploadWpMedia(credentials, fileName, contentType, imageBuffer) as { id: number; source_url?: string; guid?: { rendered?: string } };

      // Use the hero image (or first image) as featured media
      if (asset.role === "hero" || !featuredMediaId) {
        featuredMediaId = wpMedia.id;
      }

      uploadedImages.push({
        role: asset.role,
        placementKey: asset.placement_key,
        altText: asset.alt_text,
        url: wpMedia.source_url ?? wpMedia.guid?.rendered ?? asset.public_url,
      });
    } catch {
      // Non-fatal: continue publishing without this image
    }
  }

  if (expectedImageCount > 0 && !uploadedImages.length) {
    throw new Error("No generated images could be uploaded to WordPress.");
  }

  const articleMarkdown = row.article_markdown ? insertArticleImages(row.article_markdown, uploadedImages) : "";
  const contentHtml = articleMarkdown ? await marked.parse(articleMarkdown) : "";
  const existingWpPostId =
    typeof row.publish_result_json?.wpPostId === "number"
      ? row.publish_result_json.wpPostId
      : row.slug
        ? (await findWpPostBySlug(credentials, row.slug))?.id
        : undefined;

  const postPayload = {
    title: row.title ?? `${row.kind} article`,
    slug: row.slug ?? undefined,
    content: contentHtml,
    excerpt: row.excerpt ?? undefined,
    status: site.wordpress_post_status,
    author: wpAuthorId,
    categories: wpCategoryIds,
    featured_media: featuredMediaId,
  };

  const post = existingWpPostId
    ? await updateWpPost(credentials, existingWpPostId, postPayload)
    : await createWpPost(credentials, postPayload);

  // Note: author usage_count is incremented at selection time (selectAuthorForSite)
  // Category usage_count is incremented at selection time (handleBlogCandidateSelect)

  publishResult = {
    published: true,
    updatedExistingPost: Boolean(existingWpPostId),
    wpPostId: (post as { id?: number }).id,
    wpPostUrl: (post as { link?: string }).link,
    imagesEmbedded: uploadedImages.length,
    post,
  };

  await query(
    `
      update content_items
      set stage = 'published',
          status = 'published',
          published_at = now(),
          publish_result_json = $2
      where id = $1
    `,
    [contentItemId, JSON.stringify(publishResult)],
  );

  return publishResult;
}

async function handleBackfillCreate(siteId?: string) {
  const targetSites = siteId
    ? await query<{ id: string }>(
        `
          select s.id
          from sites s
          join site_setup su on su.site_id = s.id
          join site_settings ss on ss.site_id = s.id
          where s.id = $1
            and coalesce(su.setup_state, 'needs_setup') = 'ready'
            and coalesce(su.credentials_test_state, 'untested') = 'passed'
            and coalesce(ss.allow_blog, false) = true
        `,
        [siteId],
      )
    : await query<{ id: string }>(
        `
          select s.id
          from sites s
          join site_setup su on su.site_id = s.id
          join site_settings ss on ss.site_id = s.id
          where coalesce(su.setup_state, 'needs_setup') = 'ready'
            and coalesce(su.credentials_test_state, 'untested') = 'passed'
            and coalesce(ss.allow_blog, false) = true
            and exists (
              select 1
              from site_authors sa
              where sa.site_id = s.id
                and sa.active = true
                and sa.wp_author_id is not null
            )
            and exists (
              select 1
              from site_categories sc
              where sc.site_id = s.id
                and sc.active = true
                and sc.wp_category_id is not null
            )
        `,
      );

  let queued = 0;
  for (const site of targetSites.rows) {
    const keywords = await query<{ id: string; category_id: string }>(
      `
        select k.id, k.category_id
        from keyword_candidates k
        join site_categories sc on sc.id = k.category_id
        where k.site_id = $1
          and k.used = false
          and k.category_id is not null
          and sc.active = true
        order by k.created_at asc
        limit 3
      `,
      [site.id],
    );

    for (const keyword of keywords.rows) {
      const authorId = await selectAuthorForSite(site.id);
      if (!authorId) {
        continue;
      }

      const insert = await query<{ id: string }>(
        `
          insert into content_items (site_id, kind, stage, status, source_keyword_id, category_id, author_id, scheduled_for)
          values ($1, 'blog', 'research', 'queued', $2, $3, $4, now() - interval '1 day')
          returning id
        `,
        [site.id, keyword.id, keyword.category_id, authorId],
      );
      await query("update keyword_candidates set used = true where id = $1", [keyword.id]);
      await query("update site_categories set usage_count = usage_count + 1 where id = $1", [keyword.category_id]);
      await enqueueJob("blog.seo_brief_generate", { contentItemId: insert.rows[0].id }, "content", insert.rows[0].id);
      queued += 1;
    }
  }

  return { queued };
}

async function handleSystemHeartbeat(siteId?: string) {
  const keywords = await handleKeywordsInventoryAudit(siteId);
  const rss = await handleRssPoll(siteId);
  const news = await handleNewsCandidateSelect(siteId);
  const blog = await handleBlogCandidateSelect(siteId);
  const imageBatches = await handleImageBatchPoll(siteId);

  return {
    scope: siteId ? "site" : "global",
    siteId: siteId ?? null,
    keywords,
    rss,
    news,
    blog,
    imageBatches,
  };
}

async function handleImageBatchPoll(siteId?: string) {
  // Recover image jobs only after they have been running long enough to be stale.
  const stuck = await query<{ id: string }>(
    `
      select id from content_items
      where stage = 'image_generation' and status = 'running'
        and updated_at < now() - interval '20 minutes'
        and ($1::uuid is null or site_id = $1::uuid)
      order by updated_at asc
      limit 10
    `,
    [siteId ?? null],
  );

  let requeued = 0;
  for (const item of stuck.rows) {
    await enqueueJob("content.image_generate", { contentItemId: item.id }, "content", item.id);
    requeued += 1;
  }

  return { requeued };
}

export async function runJob(job: BossJob) {
  await markJobRunning(job.id, job.name, job.data ?? {});

  try {
    let result: unknown;

    switch (job.name) {
      case "system.heartbeat":
        result = await handleSystemHeartbeat(job.data?.siteId ? String(job.data.siteId) : undefined);
        break;
      case "site.initiate":
      case "site.onboard":
        result = await handleSiteInitiate(String(job.data?.siteId ?? job.data?.targetId ?? ""));
        break;
      case "site.profile_generate":
        result = await handleSiteInitiate(String(job.data?.siteId ?? job.data?.targetId ?? ""));
        break;
      case "site.wordpress_sync":
        result = await handleSiteWordpressSync(String(job.data?.siteId ?? job.data?.targetId ?? ""));
        break;
      case "keywords.inventory_audit":
        result = await handleKeywordsInventoryAudit();
        break;
      case "keywords.seed_generate":
        result = await runAdaptiveKeywordResearch(
          String(job.data?.siteId ?? ""),
          Number(job.data?.requiredCount ?? job.data?.batchSize ?? 8),
        );
        break;
      case "keywords.expand":
        result = await handleKeywordsExpand(String(job.data?.siteId ?? ""), {
          researchRunId: job.data?.researchRunId ? String(job.data.researchRunId) : undefined,
        });
        break;
      case "keywords.cluster_review":
        result = await handleKeywordsClusterReview(String(job.data?.siteId ?? ""), {
          researchRunId: job.data?.researchRunId ? String(job.data.researchRunId) : undefined,
        });
        break;
      case "keywords.persist":
        result = await handleKeywordsPersist(String(job.data?.siteId ?? ""), {
          researchRunId: job.data?.researchRunId ? String(job.data.researchRunId) : undefined,
        });
        break;
      case "rss.item_ingest":
      case "content.image_plan_generate":
        result = { noop: true, queue: job.name };
        break;
      case "news.source_scrape":
        // Source scraping is now integrated into the news.rewrite handler
        result = { integrated: true, queue: job.name };
        break;
      case "rss.poll":
        result = await handleRssPoll();
        break;
      case "rss.retention_cleanup":
        result = await handleRssRetentionCleanup();
        break;
      case "news.candidate_select":
        result = await handleNewsCandidateSelect();
        break;
      case "news.rewrite":
        result = await handleNewsRewrite(String(job.data?.contentItemId ?? ""));
        break;
      case "news.publish":
      case "wordpress.publish":
        result = await handleWordPressPublish(String(job.data?.contentItemId ?? ""));
        break;
      case "blog.candidate_select":
        result = await handleBlogCandidateSelect();
        break;
      case "blog.seo_brief_generate":
        result = await handleBlogSeoBriefGenerate(String(job.data?.contentItemId ?? ""));
        break;
      case "blog.outline_generate":
        result = await handleBlogOutlineGenerate(String(job.data?.contentItemId ?? ""));
        break;
      case "blog.outline_review":
        result = await handleBlogOutlineReview(String(job.data?.contentItemId ?? ""));
        break;
      case "blog.draft_generate":
        result = await handleBlogDraftGenerate(String(job.data?.contentItemId ?? ""));
        break;
      case "blog.draft_review":
        result = await handleBlogDraftReview(String(job.data?.contentItemId ?? ""));
        break;
      case "content.image_generate":
        result = await handleContentImageGenerate(String(job.data?.contentItemId ?? ""));
        break;
      case "content.image_batch_poll":
        result = await handleImageBatchPoll();
        break;
      case "content.backfill_create":
        result = await handleBackfillCreate(job.data?.siteId ? String(job.data.siteId) : undefined);
        break;
      default:
        result = { noop: true, queue: job.name };
    }

    await completeJob(job.id, "succeeded", result, "Job completed");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    await completeJob(job.id, "failed", { error: message }, message);
    throw error;
  }
}
