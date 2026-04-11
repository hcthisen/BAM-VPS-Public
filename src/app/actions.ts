"use server";

import { resolve as dnsResolve } from "node:dns/promises";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createInitialAdmin, loginAdmin, logoutAdmin, requireAdminSession } from "@/lib/auth/server";
import { query, withTransaction } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { enqueueJob, type QueueName } from "@/lib/jobs";
import { deleteAssets } from "@/lib/providers/storage";
import { getWpCurrentUser, listWpCategories, type WordPressCredentials } from "@/lib/providers/wordpress";
import { getAppSetting, setAppSetting, upsertProviderAccount } from "@/lib/settings";
import { getSiteWordPressCredentials, upsertSiteWordPressCredentials } from "@/lib/site-credentials";
import { canInitiateSite, deriveSetupState, type CredentialTestState, type SiteSetupState, type SiteStepState } from "@/lib/sites/lifecycle";
import { slugify } from "@/lib/services/slug";

function getRequiredText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getOptionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function getBoolean(formData: FormData, key: string) {
  return String(formData.get(key) ?? "") === "on";
}

function getPositiveInt(formData: FormData, key: string, fallback: number, minimum = 0) {
  const parsed = Number.parseInt(String(formData.get(key) ?? fallback), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

function getTextLines(formData: FormData, key: string) {
  return String(formData.get(key) ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function deriveBaseUrl(wordpressUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(wordpressUrl);
  } catch {
    throw new Error("WordPress URL must be a valid absolute URL.");
  }

  const cleanedPath = parsed.pathname
    .replace(/\/(?:wp-admin(?:\/.*)?|wp-login\.php|xmlrpc\.php|wp-json(?:\/.*)?)$/i, "")
    .replace(/\/+$/, "");

  return `${parsed.origin}${cleanedPath}`;
}

function redirectWithError(pathname: string, message: string) {
  redirect(`${pathname}?error=${encodeURIComponent(message)}` as never);
}

const siteTabs = ["setup", "automation", "feeds", "keywords", "content", "activity"] as const;
type SiteTab = (typeof siteTabs)[number];

type SiteSetupRow = {
  setup_state: SiteSetupState;
  basics_state: SiteStepState;
  credentials_test_state: CredentialTestState;
  wordpress_sync_state: SiteStepState;
  profile_state: SiteStepState;
  keyword_state: SiteStepState;
  ready_at: string | null;
};

function getSiteTab(formData: FormData): SiteTab {
  const requested = String(formData.get("returnTab") ?? "setup");
  return siteTabs.includes(requested as SiteTab) ? (requested as SiteTab) : "setup";
}

function getSitePath(siteId: string, tab: SiteTab, error?: string) {
  const params = new URLSearchParams({ tab });
  if (error) {
    params.set("error", error);
  }
  return `/sites/${siteId}?${params.toString()}`;
}

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

function toWordPressCredentials(baseUrl: string, username: string | null, applicationPassword: string | null): WordPressCredentials | null {
  if (!username || !applicationPassword) {
    return null;
  }

  return {
    baseUrl,
    username,
    applicationPassword,
  };
}

function nextSetupStateForNonReadySite(
  current: SiteSetupRow,
  patch: Partial<{
    basicsState: SiteStepState;
    credentialsTestState: CredentialTestState;
    wordpressSyncState: SiteStepState;
    profileState: SiteStepState;
    keywordState: SiteStepState;
  }>,
) {
  return deriveSetupState({
    currentState: current.setup_state,
    basicsState: patch.basicsState ?? current.basics_state,
    credentialsTestState: patch.credentialsTestState ?? current.credentials_test_state,
    wordpressSyncState: patch.wordpressSyncState ?? current.wordpress_sync_state,
    profileState: patch.profileState ?? current.profile_state,
    keywordState: patch.keywordState ?? current.keyword_state,
    readyAt: current.ready_at,
  });
}

function revalidateSiteViews(siteId: string) {
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/feeds");
  revalidatePath("/keywords");
  revalidatePath("/content");
  revalidatePath("/jobs");
}

export async function setupAdminAction(formData: FormData) {
  const email = getRequiredText(formData, "email");
  const password = getRequiredText(formData, "password");
  const setupToken = getRequiredText(formData, "setupToken");

  if (!email || !password || !setupToken) {
    redirectWithError("/setup", "Email, password, and setup token are required.");
  }

  try {
    await createInitialAdmin(email, password, setupToken);
  } catch (error) {
    redirectWithError("/setup", error instanceof Error ? error.message : "Unable to complete setup.");
  }

  redirect("/");
}

export async function loginAdminAction(formData: FormData) {
  const email = getRequiredText(formData, "email");
  const password = getRequiredText(formData, "password");

  if (!email || !password) {
    redirectWithError("/login", "Email and password are required.");
  }

  try {
    await loginAdmin(email, password);
  } catch (error) {
    redirectWithError("/login", error instanceof Error ? error.message : "Unable to sign in.");
  }

  redirect("/");
}

export async function logoutAdminAction() {
  await logoutAdmin();
  redirect("/login");
}

export async function createSiteAction(formData: FormData) {
  await requireAdminSession();

  const name = getRequiredText(formData, "name");
  const wordpressUrl = getRequiredText(formData, "wordpressUrl");
  const baseUrl = deriveBaseUrl(wordpressUrl);

  if (!name || !wordpressUrl) {
    throw new Error("Name and WordPress URL are required.");
  }

  const result = await query<{ id: string }>(
    `
      insert into sites (name, slug, base_url, wordpress_url, language_code, location_code, status, posts_per_day, news_per_day)
      values ($1, $2, $3, $4, null, null, 'draft', 1, 1)
      returning id
    `,
    [name, slugify(name), baseUrl, wordpressUrl],
  );

  await query(
    `
      insert into site_settings (site_id, allow_blog, allow_news, auto_post, wordpress_post_status, images_per_h2_section)
      values ($1, false, false, false, 'publish', 1)
      on conflict (site_id) do nothing
    `,
    [result.rows[0].id],
  );

  await query(
    `
      insert into site_setup (site_id, setup_state, basics_state, credentials_test_state, wordpress_sync_state, profile_state, keyword_state)
      values ($1, 'needs_setup', 'pending', 'untested', 'blocked', 'blocked', 'blocked')
      on conflict (site_id) do nothing
    `,
    [result.rows[0].id],
  );

  revalidateSiteViews(result.rows[0].id);
  redirect(getSitePath(result.rows[0].id, "setup") as never);
}

export async function deleteSiteAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const confirmation = getRequiredText(formData, "confirmation");

  if (!siteId) {
    redirect("/sites");
  }

  if (confirmation !== "DELETE") {
    redirect(getSitePath(siteId, "setup", "Type DELETE to confirm site deletion.") as never);
  }

  const deleteResult = await withTransaction(async (client) => {
    const site = await client.query<{ id: string; name: string }>(
      "select id, name from sites where id = $1 limit 1",
      [siteId],
    );

    const siteRow = site.rows[0];
    if (!siteRow) {
      return null;
    }

    const content = await client.query<{ id: string }>(
      "select id from content_items where site_id = $1",
      [siteId],
    );
    const contentIds = content.rows.map((row) => row.id);

    const assets = await client.query<{ storage_path: string | null }>(
      `
        select ca.storage_path
        from content_assets ca
        join content_items ci on ci.id = ca.content_item_id
        where ci.site_id = $1
          and ca.storage_path is not null
      `,
      [siteId],
    );
    const assetPaths = assets.rows.flatMap((row) => row.storage_path ? [row.storage_path] : []);

    const feeds = await client.query<{ feed_id: string }>(
      "select feed_id from site_rss_subscriptions where site_id = $1",
      [siteId],
    );
    const feedIds = feeds.rows.map((row) => row.feed_id);

    await client.query(
      `
        delete from job_runs
        where (target_type = 'site' and target_id = $1)
           or (target_type = 'content' and target_id = any($2::text[]))
      `,
      [siteId, contentIds],
    );

    await client.query("delete from sites where id = $1", [siteId]);

    if (feedIds.length) {
      await client.query(
        `
          delete from rss_feeds rf
          where rf.id = any($1::uuid[])
            and not exists (
              select 1
              from site_rss_subscriptions sub
              where sub.feed_id = rf.id
            )
        `,
        [feedIds],
      );
    }

    return {
      name: siteRow.name,
      assetPaths,
    };
  });

  if (deleteResult?.assetPaths.length) {
    try {
      await deleteAssets(deleteResult.assetPaths);
    } catch (error) {
      console.error(`Deleted site ${deleteResult.name}, but asset storage cleanup failed.`, error);
    }
  }

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/feeds");
  revalidatePath("/keywords");
  revalidatePath("/content");
  revalidatePath("/jobs");

  redirect("/sites");
}

export async function saveSiteBasicsAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTab = getSiteTab(formData);
  const name = getRequiredText(formData, "name");
  const wordpressUrl = getRequiredText(formData, "wordpressUrl");
  const baseUrl = deriveBaseUrl(wordpressUrl);
  const languageCode = getRequiredText(formData, "languageCode");
  const locationCode = getRequiredText(formData, "locationCode");
  const postsPerDay = getPositiveInt(formData, "postsPerDay", 1, 1);
  const newsPerDay = getPositiveInt(formData, "newsPerDay", 1, 0);
  const imagesPerH2Section = getPositiveInt(formData, "imagesPerH2Section", 1, 0);

  if (!siteId || !name || !wordpressUrl || !languageCode || !locationCode) {
    redirect(getSitePath(siteId, returnTab, "Complete all site basics before continuing.") as never);
  }

  await query(
    `
      update sites
      set name = $2,
          slug = $3,
          base_url = $4,
          wordpress_url = $5,
          language_code = $6,
          location_code = $7,
          posts_per_day = $8,
          news_per_day = $9,
          updated_at = now()
      where id = $1
    `,
    [siteId, name, slugify(name), baseUrl, wordpressUrl, languageCode, locationCode, postsPerDay, newsPerDay],
  );

  await query(
    `
      insert into site_settings (site_id, allow_blog, allow_news, auto_post, wordpress_post_status, images_per_h2_section)
      values ($1, false, false, false, 'publish', $2)
      on conflict (site_id) do update
      set images_per_h2_section = excluded.images_per_h2_section,
          updated_at = now()
    `,
    [siteId, imagesPerH2Section],
  );

  const current = await loadSiteSetup(siteId);
  const nextState = current.setup_state === "ready" ? "ready" : nextSetupStateForNonReadySite(current, { basicsState: "passed" });

  await query(
    `
      insert into site_setup (site_id, setup_state, basics_state, credentials_test_state, wordpress_sync_state, profile_state, keyword_state)
      values ($1, $2, 'passed', $3, $4, $5, $6)
      on conflict (site_id) do update
      set setup_state = excluded.setup_state,
          basics_state = excluded.basics_state,
          updated_at = now()
    `,
    [siteId, nextState, current.credentials_test_state, current.wordpress_sync_state, current.profile_state, current.keyword_state],
  );

  revalidateSiteViews(siteId);
  redirect(getSitePath(siteId, returnTab) as never);
}

export async function saveSiteCredentialsAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTab = getSiteTab(formData);
  const wordpressUsername = getOptionalText(formData, "wordpressUsername");
  const wordpressApplicationPassword = getOptionalText(formData, "wordpressApplicationPassword");

  await upsertSiteWordPressCredentials(siteId, wordpressUsername, wordpressApplicationPassword);

  const current = await loadSiteSetup(siteId);
  const nextState = current.setup_state === "ready" ? "ready" : nextSetupStateForNonReadySite(current, { credentialsTestState: "untested" });

  await query(
    `
      insert into site_setup (
        site_id,
        setup_state,
        basics_state,
        credentials_test_state,
        credentials_saved_at,
        credentials_tested_at,
        credentials_test_message,
        wordpress_sync_state,
        profile_state,
        keyword_state
      )
      values ($1, $2, $3, 'untested', now(), null, 'Credentials saved. Test the WordPress connection before initiating the site.', $4, $5, $6)
      on conflict (site_id) do update
      set setup_state = excluded.setup_state,
          basics_state = excluded.basics_state,
          credentials_test_state = excluded.credentials_test_state,
          credentials_saved_at = excluded.credentials_saved_at,
          credentials_tested_at = excluded.credentials_tested_at,
          credentials_test_message = excluded.credentials_test_message,
          updated_at = now()
    `,
    [siteId, nextState, current.basics_state, current.wordpress_sync_state, current.profile_state, current.keyword_state],
  );

  revalidateSiteViews(siteId);
  redirect(getSitePath(siteId, returnTab) as never);
}

export async function testSiteCredentialsAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTab = getSiteTab(formData);
  const site = await query<{
    wordpress_url: string;
  }>(
    `
      select s.wordpress_url
      from sites s
      where s.id = $1
      limit 1
    `,
    [siteId],
  );

  const row = site.rows[0];
  const savedCredentials = await getSiteWordPressCredentials(siteId);
  const current = await loadSiteSetup(siteId);
  const credentials = row
    ? toWordPressCredentials(row.wordpress_url, savedCredentials.wordpressUsername, savedCredentials.wordpressApplicationPassword)
    : null;

  if (!row || !credentials) {
    await query(
      `
        update site_setup
        set credentials_test_state = 'failed',
            credentials_tested_at = now(),
            credentials_test_message = 'Save a WordPress username and application password before testing the connection.',
            setup_state = $2,
            updated_at = now()
        where site_id = $1
      `,
      [siteId, current.ready_at ? current.setup_state : "attention"],
    );

    revalidateSiteViews(siteId);
    redirect(getSitePath(siteId, returnTab) as never);
  }

  await query(
    `
      update site_setup
      set credentials_test_state = 'running',
          credentials_test_message = 'Testing WordPress connection...',
          updated_at = now()
      where site_id = $1
    `,
    [siteId],
  );

  try {
    const [user, categories] = await Promise.all([getWpCurrentUser(credentials), listWpCategories(credentials)]);
    const nextState =
      current.ready_at || current.setup_state === "ready"
        ? "ready"
        : nextSetupStateForNonReadySite(current, {
            credentialsTestState: "passed",
          });

    await query(
      `
        update site_setup
        set credentials_test_state = 'passed',
            credentials_tested_at = now(),
            credentials_test_message = $2,
            setup_state = $3,
            updated_at = now()
        where site_id = $1
      `,
      [siteId, `Connected as ${user.name}. ${categories.length} WordPress categories are reachable.`, nextState],
    );
  } catch (error) {
    await query(
      `
        update site_setup
        set credentials_test_state = 'failed',
            credentials_tested_at = now(),
            credentials_test_message = $2,
            setup_state = $3,
            updated_at = now()
        where site_id = $1
      `,
      [siteId, error instanceof Error ? error.message : "WordPress connection test failed.", current.ready_at ? current.setup_state : "attention"],
    );
  }

  revalidateSiteViews(siteId);
  redirect(getSitePath(siteId, returnTab) as never);
}

export async function initiateSiteAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTab = getSiteTab(formData);
  const current = await loadSiteSetup(siteId);

  if (!canInitiateSite(current.setup_state, current.credentials_test_state)) {
    redirect(getSitePath(siteId, returnTab, "Complete site basics and pass the WordPress credential test before initiating the site.") as never);
  }

  await query(
    `
      update site_setup
      set setup_state = 'initializing',
          wordpress_sync_state = 'pending',
          wordpress_sync_message = null,
          profile_state = 'pending',
          profile_message = null,
          keyword_state = 'pending',
          keyword_message = null,
          initiated_at = now(),
          updated_at = now()
      where site_id = $1
    `,
    [siteId],
  );

  await enqueueJob("site.initiate", { siteId }, "site", siteId);

  revalidateSiteViews(siteId);
  redirect(getSitePath(siteId, returnTab) as never);
}

export async function saveSiteAutomationAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTab = getSiteTab(formData);
  const autoPost = getBoolean(formData, "autoPost");
  const allowBlog = getBoolean(formData, "allowBlog");
  const allowNews = getBoolean(formData, "allowNews");
  const wordpressPostStatus = getRequiredText(formData, "wordpressPostStatus") === "draft" ? "draft" : "publish";

  const gate = await query<{
    setup_state: SiteSetupState;
    credentials_test_state: CredentialTestState;
    feed_count: number;
  }>(
    `
      select
        coalesce(su.setup_state, 'needs_setup') as setup_state,
        coalesce(su.credentials_test_state, 'untested') as credentials_test_state,
        coalesce(ft.feed_count, 0)::int as feed_count
      from sites s
      left join site_setup su on su.site_id = s.id
      left join (
        select site_id, count(*) filter (where active = true)::int as feed_count
        from site_rss_subscriptions
        group by site_id
      ) ft on ft.site_id = s.id
      where s.id = $1
      limit 1
    `,
    [siteId],
  );

  const row = gate.rows[0];
  const setupReady = row?.setup_state === "ready" && row.credentials_test_state === "passed";
  const nextAllowBlog = setupReady ? allowBlog : false;
  const nextAllowNews = setupReady && row.feed_count > 0 ? allowNews : false;

  await query(
    `
      update site_settings
      set allow_blog = $2,
          allow_news = $3,
          auto_post = $4,
          wordpress_post_status = $5,
          updated_at = now()
      where site_id = $1
    `,
    [siteId, nextAllowBlog, nextAllowNews, autoPost, wordpressPostStatus],
  );

  revalidateSiteViews(siteId);
  redirect(getSitePath(siteId, returnTab) as never);
}

export async function createFeedSubscriptionAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const returnTo = getOptionalText(formData, "returnTo");
  const title = getRequiredText(formData, "title");
  const url = getRequiredText(formData, "url");
  const categoryLabel = getOptionalText(formData, "categoryLabel");
  const pollMinutes = getPositiveInt(formData, "pollMinutes", 60, 1);

  if (!siteId || !title || !url) {
    throw new Error("Site, title, and URL are required.");
  }

  const feedResult = await query<{ id: string }>(
    `
      insert into rss_feeds (title, url, active)
      values ($1, $2, true)
      on conflict (url) do update set title = excluded.title
      returning id
    `,
    [title, url],
  );

  await query(
    `
      insert into site_rss_subscriptions (site_id, feed_id, category_label, active, poll_minutes)
      values ($1, $2, $3, true, $4)
      on conflict (site_id, feed_id) do update
      set category_label = excluded.category_label,
          active = true,
          poll_minutes = excluded.poll_minutes
    `,
    [siteId, feedResult.rows[0].id, categoryLabel, pollMinutes],
  );

  revalidateSiteViews(siteId);

  if (returnTo) {
    redirect(returnTo as never);
  }
}

export async function removeFeedSubscriptionAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  const subscriptionId = getRequiredText(formData, "subscriptionId");
  const returnTo = getOptionalText(formData, "returnTo");

  if (!siteId || !subscriptionId) {
    throw new Error("Site and subscription are required.");
  }

  const subscriptionResult = await query<{ feed_id: string }>(
    `
      delete from site_rss_subscriptions
      where id = $1 and site_id = $2
      returning feed_id
    `,
    [subscriptionId, siteId],
  );

  const feedId = subscriptionResult.rows[0]?.feed_id;

  if (feedId) {
    const usageResult = await query<{ usage_count: number }>(
      `
        select count(*)::int as usage_count
        from site_rss_subscriptions
        where feed_id = $1
      `,
      [feedId],
    );

    if ((usageResult.rows[0]?.usage_count ?? 0) === 0) {
      await query("delete from rss_feeds where id = $1", [feedId]);
    }
  }

  const remainingFeedResult = await query<{ feed_count: number }>(
    `
      select count(*) filter (where active = true)::int as feed_count
      from site_rss_subscriptions
      where site_id = $1
    `,
    [siteId],
  );

  if ((remainingFeedResult.rows[0]?.feed_count ?? 0) === 0) {
    await query(
      `
        update site_settings
        set allow_news = false,
            updated_at = now()
        where site_id = $1
      `,
      [siteId],
    );
  }

  revalidateSiteViews(siteId);

  if (returnTo) {
    redirect(returnTo as never);
  }
}

export async function queueJobAction(formData: FormData) {
  await requireAdminSession();

  const queueName = getRequiredText(formData, "queueName") as QueueName;
  const targetType = getOptionalText(formData, "targetType") ?? undefined;
  const targetId = getOptionalText(formData, "targetId") ?? undefined;

  if (!queueName) {
    throw new Error("Queue name is required.");
  }

  await enqueueJob(queueName, {}, targetType, targetId);

  revalidatePath("/");
  revalidatePath("/jobs");
}

export async function runHeartbeatAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getOptionalText(formData, "siteId") ?? undefined;
  const returnTo = getOptionalText(formData, "returnTo");

  await enqueueJob(
    "system.heartbeat",
    siteId ? { siteId } : {},
    siteId ? "site" : "system",
    siteId ?? "heartbeat",
  );

  revalidatePath("/");
  revalidatePath("/jobs");
  if (siteId) {
    revalidateSiteViews(siteId);
  }

  if (returnTo) {
    redirect(returnTo as never);
  }
}

export async function saveSiteProfileAction(formData: FormData) {
  await requireAdminSession();

  const siteId = getRequiredText(formData, "siteId");
  if (!siteId) throw new Error("Missing siteId");

  await query(
    `
      update site_profiles
      set site_summary = $2,
          niche_summary = $3,
          audience_summary = $4,
          tone_guide = $5,
          topic_pillar_map_json = $6::jsonb,
          content_exclusions_json = $7::jsonb,
          updated_at = now()
      where site_id = $1
    `,
    [
      siteId,
      getOptionalText(formData, "siteSummary") ?? "",
      getOptionalText(formData, "nicheSummary") ?? "",
      getOptionalText(formData, "audienceSummary") ?? "",
      getOptionalText(formData, "toneGuide") ?? "",
      JSON.stringify(getTextLines(formData, "topicPillarsText")),
      JSON.stringify(getTextLines(formData, "contentExclusionsText")),
    ],
  );

  revalidatePath(`/sites/${siteId}`);
}

export async function saveOpenAiSettingsAction(formData: FormData) {
  await requireAdminSession();

  await upsertProviderAccount(
    "openai",
    {
      textModel: getRequiredText(formData, "textModel"),
      writingModel: getRequiredText(formData, "writingModel"),
      imageModel: getRequiredText(formData, "imageModel"),
    },
    {
      apiKey: getOptionalText(formData, "apiKey"),
    },
  );

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function saveDataForSeoSettingsAction(formData: FormData) {
  await requireAdminSession();

  await upsertProviderAccount(
    "dataforseo",
    {},
    {
      login: getOptionalText(formData, "login"),
      apiKey: getOptionalText(formData, "apiKey"),
    },
  );

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function saveS3SettingsAction(formData: FormData) {
  await requireAdminSession();

  await upsertProviderAccount(
    "s3",
    {
      endpoint: getOptionalText(formData, "endpoint"),
      region: getOptionalText(formData, "region"),
      bucket: getOptionalText(formData, "bucket"),
    },
    {
      accessKey: getOptionalText(formData, "accessKey"),
      secretKey: getOptionalText(formData, "secretKey"),
    },
  );

  revalidatePath("/");
  revalidatePath("/settings");
}

// Domain Management

export type DomainSettings = {
  domain: string | null;
  verified: boolean;
  sslActive: boolean;
};

function getConfiguredDomainSettings(): DomainSettings {
  try {
    const appUrl = new URL(getEnv().BAM_APP_URL);
    const isPublicHost = !["localhost", "127.0.0.1"].includes(appUrl.hostname);

    if (appUrl.protocol === "https:" && isPublicHost) {
      return { domain: appUrl.hostname, verified: true, sslActive: true };
    }
  } catch {
    // Fall through to an empty domain card.
  }

  return { domain: null, verified: false, sslActive: false };
}

export async function getDomainSettings(): Promise<DomainSettings> {
  return getAppSetting<DomainSettings>("domain", getConfiguredDomainSettings());
}

function normalizeDomain(input: string) {
  const domain = input.trim().toLowerCase();
  const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

  if (!domainPattern.test(domain)) {
    throw new Error("Invalid domain format. Example: bam.yourdomain.com");
  }

  return domain;
}

async function getVpsIp(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=text", { cache: "no-store" });
    return (await response.text()).trim();
  } catch {
    return "unknown";
  }
}

export async function checkDnsAction(_prev: unknown, formData: FormData): Promise<{ ok: boolean; message: string; vpsIp?: string; dnsIp?: string }> {
  await requireAdminSession();

  const rawDomain = getRequiredText(formData, "domain");
  if (!rawDomain) {
    return { ok: false, message: "Please enter a domain." };
  }

  let domain: string;
  try {
    domain = normalizeDomain(rawDomain);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid domain." };
  }

  try {
    const [dnsAddresses, vpsIp] = await Promise.all([
      dnsResolve(domain).catch(() => []),
      getVpsIp(),
    ]);

    if (dnsAddresses.length === 0) {
      return { ok: false, message: `DNS lookup failed. No A record found for ${domain}.`, vpsIp };
    }

    const dnsIp = dnsAddresses[0];
    if (dnsIp !== vpsIp) {
      return {
        ok: false,
        message: `DNS mismatch: ${domain} points to ${dnsIp}, but this VPS is ${vpsIp}. Update your DNS A record to point to ${vpsIp}.`,
        vpsIp,
        dnsIp,
      };
    }

    return { ok: true, message: `DNS verified: ${domain} -> ${vpsIp}`, vpsIp, dnsIp };
  } catch (error) {
    return { ok: false, message: `DNS check failed: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

export async function addDomainAction(formData: FormData) {
  await requireAdminSession();

  const rawDomain = getRequiredText(formData, "domain");
  if (!rawDomain) {
    redirectWithError("/settings", "Please enter a domain.");
  }

  const domain = normalizeDomain(rawDomain);
  const caddyfile = `# BAM Control - Managed by BAM app
# Domain: ${domain}

${domain} {
\treverse_proxy 127.0.0.1:3000
}
`;

  await applyCaddyConfig(caddyfile);
  await setAppSetting("domain", { domain, verified: true, sslActive: true });

  revalidatePath("/");
  revalidatePath("/settings");
}

export async function removeDomainAction() {
  await requireAdminSession();

  const caddyfile = `# BAM Control - Caddy reverse proxy
# No custom domain configured

:80 {
\treverse_proxy 127.0.0.1:3000
}
`;

  await applyCaddyConfig(caddyfile);
  await setAppSetting("domain", { domain: null, verified: false, sslActive: false });

  revalidatePath("/");
  revalidatePath("/settings");
}

async function applyCaddyConfig(caddyfile: string) {
  const { execFileSync } = await import("node:child_process");
  const result = execFileSync("sudo", ["/opt/bam/scripts/caddy-update.sh"], {
    input: caddyfile,
    timeout: 30000,
    encoding: "utf-8",
  });

  if (result.trim() !== "OK") {
    throw new Error(`Caddy config validation failed: ${result}`);
  }
}
