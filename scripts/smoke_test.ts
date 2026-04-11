import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { closePool, query } from "@/lib/db";
import { closeBoss } from "@/lib/jobs";
import { runJob } from "@/worker/jobs/handlers";

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
  const suffix = randomUUID().slice(0, 8);
  const siteName = `Smoke Site ${suffix}`;
  const siteUrl = `https://example.com/${suffix}`;
  const locale = await getReferenceLocale();

  const site = await query<{ id: string }>(
    `
      insert into sites (name, slug, base_url, wordpress_url, status, language_code, location_code, posts_per_day, news_per_day)
      values ($1, $2, $3, $3, 'active', $4, $5, 1, 1)
      returning id
    `,
    [siteName, `smoke-site-${suffix}`, siteUrl, locale.languageCode, locale.locationCode],
  );

  const siteId = site.rows[0].id;

  await query(
    `
      insert into site_settings (site_id, allow_blog, allow_news, auto_post, wordpress_post_status, images_per_h2_section)
      values ($1, true, true, false, 'publish', 0)
    `,
    [siteId],
  );

  await query(
    `
      insert into site_profiles (site_id, site_summary, audience_summary, tone_guide, niche_summary, profile_json)
      values ($1, 'Smoke summary', 'Smoke audience', 'Direct', 'Testing', '{}'::jsonb)
      on conflict (site_id) do nothing
    `,
    [siteId],
  );

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

  const profile = await query<{ site_summary: string | null }>("select site_summary from site_profiles where site_id = $1", [siteId]);
  assert.ok(profile.rowCount === 1, "site profile should exist for the smoke site");

  const keyword = await query<{ id: string }>(
    `
      insert into keyword_candidates (site_id, keyword, source, used)
      values ($1, $2, 'smoke', false)
      returning id
    `,
    [siteId, `smoke keyword ${suffix}`],
  );

  const blogContent = await query<{ id: string }>(
    `
      insert into content_items (site_id, kind, stage, status, source_keyword_id)
      values ($1, 'blog', 'research', 'queued', $2)
      returning id
    `,
    [siteId, keyword.rows[0].id],
  );

  const blogContentId = blogContent.rows[0].id;

  await runJob({ id: `smoke-blog-seo-${suffix}`, name: "blog.seo_brief_generate", data: { contentItemId: blogContentId } });
  await runJob({ id: `smoke-blog-outline-${suffix}`, name: "blog.outline_generate", data: { contentItemId: blogContentId } });
  await runJob({ id: `smoke-blog-draft-${suffix}`, name: "blog.draft_generate", data: { contentItemId: blogContentId } });
  const blogDraft = await query<{ status: string; stage: string }>(
    "select status, stage from content_items where id = $1",
    [blogContentId],
  );
  assert.equal(blogDraft.rows[0].status, "ready");
  assert.equal(blogDraft.rows[0].stage, "image_plan");

  const feed = await query<{ id: string }>(
    `
      insert into rss_feeds (title, url, active)
      values ($1, $2, true)
      returning id
    `,
    [`Smoke Feed ${suffix}`, `https://example.com/feed/${suffix}.xml`],
  );

  await query(
    `
      insert into site_rss_subscriptions (site_id, feed_id, active, poll_minutes)
      values ($1, $2, true, 60)
    `,
    [siteId, feed.rows[0].id],
  );

  const rssItem = await query<{ id: string }>(
    `
      insert into rss_items (feed_id, source_url, title, summary)
      values ($1, $2, $3, $4)
      returning id
    `,
    [feed.rows[0].id, `https://example.com/story/${suffix}`, `Smoke Story ${suffix}`, "Short summary"],
  );

  const newsContent = await query<{ id: string }>(
    `
      insert into content_items (site_id, kind, stage, status, source_rss_item_id, source_url)
      values ($1, 'news', 'research', 'queued', $2, $3)
      returning id
    `,
    [siteId, rssItem.rows[0].id, `https://example.com/story/${suffix}`],
  );

  const newsContentId = newsContent.rows[0].id;

  await runJob({ id: `smoke-news-rewrite-${suffix}`, name: "news.rewrite", data: { contentItemId: newsContentId } });
  const newsDraft = await query<{ status: string; stage: string }>(
    "select status, stage from content_items where id = $1",
    [newsContentId],
  );
  assert.equal(newsDraft.rows[0].status, "ready");
  assert.equal(newsDraft.rows[0].stage, "image_plan");

  console.log("Smoke test completed.");
  await closeBoss();
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closeBoss().catch(() => undefined);
  await closePool().catch(() => undefined);
  process.exit(1);
});
