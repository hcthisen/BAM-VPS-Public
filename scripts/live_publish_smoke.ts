import "dotenv/config";

import { randomUUID } from "node:crypto";

import { closePool, query } from "@/lib/db";
import { closeBoss } from "@/lib/jobs";
import { deleteWpPost, getWpCurrentUser, getWpPost, listWpCategories, type WordPressCredentials } from "@/lib/providers/wordpress";
import { upsertSiteWordPressCredentials } from "@/lib/site-credentials";
import { runJob } from "@/worker/jobs/handlers";

function getCredentials(): WordPressCredentials {
  const baseUrl = process.env.WORDPRESS_URL?.trim();
  const username = process.env.WORDPRESS_USER?.trim();
  const applicationPassword = process.env.WORDPRESS_APPLICATION_PASSWORD?.trim();

  if (!baseUrl || !username || !applicationPassword) {
    throw new Error("WORDPRESS_URL, WORDPRESS_USER, and WORDPRESS_APPLICATION_PASSWORD are required.");
  }

  return { baseUrl, username, applicationPassword };
}

async function getReferenceLocale() {
  const [language, location] = await Promise.all([
    query<{ code: string }>(
      "select code from languages order by (code = 'en') desc, code asc limit 1",
    ),
    query<{ code: string }>(
      "select code from locations where location_type = 'Country' order by (country_iso_code = 'US') desc, code asc limit 1",
    ),
  ]);

  return {
    languageCode: language.rows[0]?.code ?? "en",
    locationCode: location.rows[0]?.code ?? "2840",
  };
}

async function main() {
  const credentials = getCredentials();
  const locale = await getReferenceLocale();
  const suffix = randomUUID().slice(0, 8);
  const siteName = `BAM live smoke ${suffix}`;
  const siteSlug = `bam-live-smoke-${suffix}`;
  const siteBaseUrl = `${credentials.baseUrl.replace(/\/$/, "")}/${siteSlug}`;
  let siteId: string | null = null;
  let wpPostId: number | null = null;

  try {
    const [currentUser, categories] = await Promise.all([
      getWpCurrentUser(credentials),
      listWpCategories(credentials),
    ]);

    const site = await query<{ id: string }>(
      `
        insert into sites (name, slug, base_url, wordpress_url, status, language_code, location_code, posts_per_day, news_per_day)
        values ($1, $2, $3, $4, 'active', $5, $6, 1, 0)
        returning id
      `,
      [siteName, siteSlug, siteBaseUrl, credentials.baseUrl, locale.languageCode, locale.locationCode],
    );
    siteId = site.rows[0].id;

    await query(
      `
        insert into site_settings (site_id, allow_blog, allow_news, auto_post, wordpress_post_status, images_per_h2_section)
        values ($1, true, false, true, 'draft', 0)
      `,
      [siteId],
    );

    await upsertSiteWordPressCredentials(siteId, credentials.username, credentials.applicationPassword);

    await query(
      `
        insert into site_setup (
          site_id,
          setup_state,
          basics_state,
          credentials_test_state,
          wordpress_sync_state,
          profile_state,
          keyword_state,
          initiated_at,
          ready_at
        )
        values ($1, 'ready', 'passed', 'passed', 'passed', 'passed', 'passed', now(), now())
      `,
      [siteId],
    );

    const author = await query<{ id: string }>(
      `
        insert into site_authors (site_id, wp_author_id, name, slug, active)
        values ($1, $2, $3, $4, true)
        returning id
      `,
      [siteId, currentUser.id, currentUser.name, currentUser.slug],
    );

    const category = categories[0]
      ? await query<{ id: string }>(
          `
            insert into site_categories (site_id, wp_category_id, name, slug, active)
            values ($1, $2, $3, $4, true)
            returning id
          `,
          [siteId, categories[0].id, categories[0].name, categories[0].slug],
        )
      : null;

    const content = await query<{ id: string }>(
      `
        insert into content_items (
          site_id,
          kind,
          stage,
          status,
          title,
          slug,
          article_markdown,
          excerpt,
          author_id,
          category_id
        )
        values ($1, 'blog', 'publish_pending', 'ready', $2, $3, $4, $5, $6, $7)
        returning id
      `,
      [
        siteId,
        `BAM live publish smoke ${suffix}`,
        `bam-live-publish-smoke-${suffix}`,
        `# BAM live publish smoke ${suffix}\n\nThis draft was created by the BAM live publish smoke test.`,
        `BAM live publish smoke ${suffix}.`,
        author.rows[0].id,
        category?.rows[0]?.id ?? null,
      ],
    );

    const result = await runJob({
      id: `live-publish-smoke-${suffix}`,
      name: "wordpress.publish",
      data: { contentItemId: content.rows[0].id },
    }) as { wpPostId?: number };

    if (!result.wpPostId) {
      throw new Error("Live publish smoke did not create a real WordPress draft.");
    }

    wpPostId = result.wpPostId;
    const post = await getWpPost(credentials, wpPostId);
    if (post.status !== "draft") {
      throw new Error(`Expected WordPress draft status, received ${post.status ?? "unknown"}.`);
    }

    console.log("Live publish smoke test completed.");
  } finally {
    if (wpPostId) {
      await deleteWpPost(credentials, wpPostId).catch(() => undefined);
    }

    if (siteId) {
      await query("delete from sites where id = $1", [siteId]).catch(() => undefined);
    }

    await closeBoss().catch(() => undefined);
    await closePool().catch(() => undefined);
  }
}

main().catch(async (error) => {
  console.error(error);
  await closeBoss().catch(() => undefined);
  await closePool().catch(() => undefined);
  process.exit(1);
});
