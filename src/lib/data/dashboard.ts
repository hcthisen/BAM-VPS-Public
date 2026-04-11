import { query } from "@/lib/db";
import { getSiteWordPressCredentials } from "@/lib/site-credentials";
import type {
  ContentRecord,
  ContentAssetRecord,
  ContentDetailRecord,
  DashboardMetrics,
  FeedRecord,
  JobRecord,
  KeywordRecord,
  SiteDetailRecord,
  SiteRecord,
} from "@/lib/types";

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const result = await query<DashboardMetrics>(`
    with site_metrics as (
      select
        count(*)::int as "siteCount",
        count(*) filter (where coalesce(su.setup_state, 'needs_setup') = 'needs_setup')::int as "needsSetupCount",
        count(*) filter (where coalesce(su.setup_state, 'needs_setup') = 'ready_to_initiate')::int as "readyToInitiateCount",
        count(*) filter (where coalesce(su.setup_state, 'needs_setup') = 'initializing')::int as "initializingCount",
        count(*) filter (
          where coalesce(su.setup_state, 'needs_setup') = 'ready'
            and not (coalesce(ss.allow_blog, false) = true or coalesce(ss.allow_news, false) = true)
        )::int as "readySiteCount",
        count(*) filter (
          where coalesce(su.setup_state, 'needs_setup') = 'ready'
            and (coalesce(ss.allow_blog, false) = true or coalesce(ss.allow_news, false) = true)
        )::int as "liveSiteCount",
        count(*) filter (where coalesce(su.setup_state, 'needs_setup') = 'attention')::int as "attentionCount"
      from sites s
      left join site_settings ss on ss.site_id = s.id
      left join site_setup su on su.site_id = s.id
    ),
    feed_metrics as (
      select count(*)::int as "feedCount" from rss_feeds
    ),
    keyword_metrics as (
      select
        count(*)::int as "keywordCount",
        count(*) filter (where used = false)::int as "unusedKeywordCount"
      from keyword_candidates
    ),
    content_metrics as (
      select
        count(*)::int as "contentCount",
        count(*) filter (where stage = 'publish_pending' and status in ('ready', 'queued'))::int as "publishReadyCount"
      from content_items
    ),
    job_metrics as (
      select count(*) filter (where status = 'failed' and created_at >= now() - interval '7 days')::int as "recentJobFailures"
      from job_runs
    )
    select
      site_metrics."siteCount",
      site_metrics."needsSetupCount",
      site_metrics."readyToInitiateCount",
      site_metrics."initializingCount",
      site_metrics."readySiteCount",
      site_metrics."liveSiteCount",
      site_metrics."attentionCount",
      feed_metrics."feedCount",
      keyword_metrics."keywordCount",
      keyword_metrics."unusedKeywordCount",
      content_metrics."contentCount",
      content_metrics."publishReadyCount",
      job_metrics."recentJobFailures"
    from site_metrics, feed_metrics, keyword_metrics, content_metrics, job_metrics
  `);

  return result.rows[0] ?? {
    siteCount: 0,
    needsSetupCount: 0,
    readyToInitiateCount: 0,
    initializingCount: 0,
    readySiteCount: 0,
    liveSiteCount: 0,
    attentionCount: 0,
    feedCount: 0,
    keywordCount: 0,
    unusedKeywordCount: 0,
    contentCount: 0,
    publishReadyCount: 0,
    recentJobFailures: 0,
  };
}

export async function listSites(): Promise<SiteRecord[]> {
  const result = await query<SiteRecord>(`
    with feed_totals as (
      select site_id, count(*) filter (where active = true)::int as feed_count
      from site_rss_subscriptions
      group by site_id
    ),
    keyword_totals as (
      select
        site_id,
        count(*)::int as keyword_count,
        count(*) filter (where used = false)::int as unused_keyword_count
      from keyword_candidates
      group by site_id
    )
    select
      sites.id,
      sites.name,
      sites.base_url as "baseUrl",
      sites.wordpress_url as "wordpressUrl",
      sites.language_code as "languageCode",
      sites.location_code as "locationCode",
      sites.status,
      coalesce(su.setup_state, 'needs_setup') as "setupState",
      case
        when coalesce(ss.allow_blog, false) = true and coalesce(ss.allow_news, false) = true then 'on'
        when coalesce(ss.allow_blog, false) = true then 'blog only'
        when coalesce(ss.allow_news, false) = true then 'news only'
        else 'off'
      end as "automationStatus",
      sites.posts_per_day as "postsPerDay",
      sites.news_per_day as "newsPerDay",
      coalesce(ss.images_per_h2_section, 1) as "imagesPerH2Section",
      coalesce(ss.allow_blog, true) as "allowBlog",
      coalesce(ss.allow_news, true) as "allowNews",
      coalesce(ss.auto_post, false) as "autoPost",
      coalesce(ss.wordpress_post_status, 'publish') as "wordpressPostStatus",
      coalesce(ft.feed_count, 0) as "feedCount",
      coalesce(kt.keyword_count, 0) as "keywordCount",
      coalesce(kt.unused_keyword_count, 0) as "unusedKeywordCount",
      sites.created_at as "createdAt",
      sites.updated_at as "updatedAt"
    from sites
    left join site_settings ss on ss.site_id = sites.id
    left join site_setup su on su.site_id = sites.id
    left join feed_totals ft on ft.site_id = sites.id
    left join keyword_totals kt on kt.site_id = sites.id
    order by sites.updated_at desc
  `);

  return result.rows;
}

export async function getSiteDetail(siteId: string): Promise<SiteDetailRecord | null> {
  const result = await query<SiteDetailRecord>(
    `
      with feed_totals as (
        select site_id, count(*) filter (where active = true)::int as feed_count
        from site_rss_subscriptions
        group by site_id
      ),
      keyword_totals as (
        select
          site_id,
          count(*)::int as keyword_count,
          count(*) filter (where used = false)::int as unused_keyword_count
        from keyword_candidates
        group by site_id
      ),
      content_totals as (
        select
          site_id,
          count(*)::int as content_count,
          count(*) filter (where stage = 'publish_pending' and status in ('ready', 'queued'))::int as publish_ready_count
        from content_items
        group by site_id
      )
      select
        s.id,
        s.name,
        s.base_url as "baseUrl",
        s.wordpress_url as "wordpressUrl",
        s.language_code as "languageCode",
        s.location_code as "locationCode",
        s.status,
        coalesce(su.setup_state, 'needs_setup') as "setupState",
        case
          when coalesce(ss.allow_blog, false) = true and coalesce(ss.allow_news, false) = true then 'on'
          when coalesce(ss.allow_blog, false) = true then 'blog only'
          when coalesce(ss.allow_news, false) = true then 'news only'
          else 'off'
        end as "automationStatus",
        s.posts_per_day as "postsPerDay",
        s.news_per_day as "newsPerDay",
        coalesce(ss.images_per_h2_section, 1) as "imagesPerH2Section",
        coalesce(ss.allow_blog, true) as "allowBlog",
        coalesce(ss.allow_news, true) as "allowNews",
        coalesce(ss.auto_post, false) as "autoPost",
        coalesce(ss.wordpress_post_status, 'publish') as "wordpressPostStatus",
        coalesce(ft.feed_count, 0) as "feedCount",
        coalesce(kt.keyword_count, 0) as "keywordCount",
        coalesce(kt.unused_keyword_count, 0) as "unusedKeywordCount",
        coalesce(su.basics_state, 'pending') as "basicsState",
        coalesce(su.credentials_test_state, 'untested') as "credentialsTestState",
        su.credentials_saved_at as "credentialsSavedAt",
        su.credentials_tested_at as "credentialsTestedAt",
        su.credentials_test_message as "credentialsTestMessage",
        coalesce(su.wordpress_sync_state, 'blocked') as "wordpressSyncState",
        su.wordpress_sync_message as "wordpressSyncMessage",
        coalesce(su.profile_state, 'blocked') as "profileState",
        su.profile_message as "profileMessage",
        coalesce(su.keyword_state, 'blocked') as "keywordState",
        su.keyword_message as "keywordMessage",
        su.initiated_at as "initiatedAt",
        su.ready_at as "readyAt",
        sc.wordpress_username as "wordpressUsername",
        (sc.secrets_encrypted is not null or sc.wordpress_application_password is not null) as "hasWordPressApplicationPassword",
        sp.site_summary as "siteSummary",
        sp.audience_summary as "audienceSummary",
        sp.tone_guide as "toneGuide",
        sp.niche_summary as "nicheSummary",
        sp.topic_pillar_map_json as "topicPillarMapJson",
        sp.content_exclusions_json as "contentExclusionsJson",
        coalesce(ct.content_count, 0) as "contentCount",
        coalesce(ct.publish_ready_count, 0) as "publishReadyCount",
        s.created_at as "createdAt",
        s.updated_at as "updatedAt"
      from sites s
      left join site_settings ss on ss.site_id = s.id
      left join site_setup su on su.site_id = s.id
      left join site_credentials sc on sc.site_id = s.id
      left join site_profiles sp on sp.site_id = s.id
      left join feed_totals ft on ft.site_id = s.id
      left join keyword_totals kt on kt.site_id = s.id
      left join content_totals ct on ct.site_id = s.id
      where s.id = $1
      limit 1
    `,
    [siteId],
  );

  const site = result.rows[0];
  if (!site) {
    return null;
  }

  const credentials = await getSiteWordPressCredentials(siteId);
  return {
    ...site,
    wordpressUsername: credentials.wordpressUsername ?? site.wordpressUsername,
    hasWordPressApplicationPassword: credentials.hasWordPressApplicationPassword,
    wordpressApplicationPasswordPreview: credentials.wordpressApplicationPasswordPreview,
  };
}

export async function listSiteFeeds(siteId: string): Promise<FeedRecord[]> {
  const result = await query<FeedRecord>(
    `
      select
        sub.id,
        sub.site_id as "siteId",
        s.name as "siteName",
        f.title,
        f.url,
        coalesce(sub.category_label, c.name) as "categoryLabel",
        sub.active,
        sub.poll_minutes as "pollMinutes",
        sub.last_polled_at as "lastPolledAt"
      from site_rss_subscriptions sub
      join sites s on s.id = sub.site_id
      join rss_feeds f on f.id = sub.feed_id
      left join site_categories c on c.id = sub.category_id
      where sub.site_id = $1
      order by sub.updated_at desc
    `,
    [siteId],
  );

  return result.rows;
}

export async function listSiteKeywords(siteId: string, limit = 100): Promise<KeywordRecord[]> {
  const result = await query<KeywordRecord>(
    `
      select
        k.id,
        k.site_id as "siteId",
        s.name as "siteName",
        k.keyword,
        k.cluster_label as "clusterLabel",
        c.name as "categoryName",
        k.difficulty,
        k.search_volume as "searchVolume",
        k.used,
        k.created_at as "createdAt"
      from keyword_candidates k
      join sites s on s.id = k.site_id
      left join site_categories c on c.id = k.category_id
      where k.site_id = $1
      order by k.updated_at desc
      limit $2
    `,
    [siteId, limit],
  );

  return result.rows;
}

export async function listSiteContent(siteId: string, limit = 100): Promise<ContentRecord[]> {
  const result = await query<ContentRecord>(
    `
      select
        ci.id,
        ci.site_id as "siteId",
        s.name as "siteName",
        ci.title,
        ci.kind,
        ci.stage,
        ci.status,
        kc.keyword as "sourceKeyword",
        coalesce(ci.source_url, ri.source_url) as "sourceUrl",
        ci.scheduled_for as "scheduledFor",
        ci.updated_at as "updatedAt"
      from content_items ci
      join sites s on s.id = ci.site_id
      left join keyword_candidates kc on kc.id = ci.source_keyword_id
      left join rss_items ri on ri.id = ci.source_rss_item_id
      where ci.site_id = $1
      order by ci.updated_at desc
      limit $2
    `,
    [siteId, limit],
  );

  return result.rows;
}

export async function listSiteJobs(siteId: string, limit = 100): Promise<JobRecord[]> {
  const result = await query<JobRecord>(
    `
      select
        jr.id,
        jr.queue_name as "queueName",
        jr.status,
        jr.target_type as "targetType",
        jr.target_id as "targetId",
        jr.message,
        jr.created_at as "createdAt",
        jr.finished_at as "finishedAt"
      from job_runs jr
      left join content_items ci on jr.target_type = 'content' and jr.target_id = ci.id::text
      where (jr.target_type = 'site' and jr.target_id = $1)
         or ci.site_id = $1::uuid
      order by jr.created_at desc
      limit $2
    `,
    [siteId, limit],
  );

  return result.rows;
}

export async function listFeeds(): Promise<FeedRecord[]> {
  const result = await query<FeedRecord>(`
    select
      sub.id,
      sub.site_id as "siteId",
      s.name as "siteName",
      f.title,
      f.url,
      coalesce(sub.category_label, c.name) as "categoryLabel",
      sub.active,
      sub.poll_minutes as "pollMinutes",
      sub.last_polled_at as "lastPolledAt"
    from site_rss_subscriptions sub
    join sites s on s.id = sub.site_id
    join rss_feeds f on f.id = sub.feed_id
    left join site_categories c on c.id = sub.category_id
    order by sub.updated_at desc
  `);

  return result.rows;
}

export async function listKeywords(limit = 250): Promise<KeywordRecord[]> {
  const result = await query<KeywordRecord>(
    `
      select
        k.id,
        k.site_id as "siteId",
        s.name as "siteName",
        k.keyword,
        k.cluster_label as "clusterLabel",
        c.name as "categoryName",
        k.difficulty,
        k.search_volume as "searchVolume",
        k.used,
        k.created_at as "createdAt"
      from keyword_candidates k
      join sites s on s.id = k.site_id
      left join site_categories c on c.id = k.category_id
      order by k.updated_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function listContent(limit = 250): Promise<ContentRecord[]> {
  const result = await query<ContentRecord>(
    `
      select
        ci.id,
        ci.site_id as "siteId",
        s.name as "siteName",
        ci.title,
        ci.kind,
        ci.stage,
        ci.status,
        kc.keyword as "sourceKeyword",
        coalesce(ci.source_url, ri.source_url) as "sourceUrl",
        ci.scheduled_for as "scheduledFor",
        ci.updated_at as "updatedAt"
      from content_items ci
      join sites s on s.id = ci.site_id
      left join keyword_candidates kc on kc.id = ci.source_keyword_id
      left join rss_items ri on ri.id = ci.source_rss_item_id
      order by ci.updated_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function getContentDetail(contentId: string): Promise<ContentDetailRecord | null> {
  const result = await query<Omit<ContentDetailRecord, "assets">>(
    `
      select
        ci.id,
        ci.site_id as "siteId",
        s.name as "siteName",
        ci.title,
        ci.slug,
        ci.kind,
        ci.stage,
        ci.status,
        kc.keyword as "sourceKeyword",
        coalesce(ci.source_url, ri.source_url) as "sourceUrl",
        ci.scheduled_for as "scheduledFor",
        ci.excerpt,
        ci.article_markdown as "articleMarkdown",
        ci.seo_brief_json as "seoBriefJson",
        ci.outline_json as "outlineJson",
        ci.image_plan_json as "imagePlanJson",
        ci.publish_result_json as "publishResultJson",
        ci.created_at as "createdAt",
        ci.updated_at as "updatedAt"
      from content_items ci
      join sites s on s.id = ci.site_id
      left join keyword_candidates kc on kc.id = ci.source_keyword_id
      left join rss_items ri on ri.id = ci.source_rss_item_id
      where ci.id = $1
      limit 1
    `,
    [contentId],
  );

  const content = result.rows[0];
  if (!content) {
    return null;
  }

  const assets = await query<ContentAssetRecord>(
    `
      select
        id,
        role,
        placement_key as "placementKey",
        alt_text as "altText",
        public_url as "publicUrl",
        storage_path as "storagePath",
        generation_status as "generationStatus",
        created_at as "createdAt"
      from content_assets
      where content_item_id = $1
      order by created_at asc
    `,
    [contentId],
  );

  return {
    ...content,
    assets: assets.rows,
  };
}

export async function listJobs(limit = 100): Promise<JobRecord[]> {
  const result = await query<JobRecord>(
    `
      select
        id,
        queue_name as "queueName",
        status,
        target_type as "targetType",
        target_id as "targetId",
        message,
        created_at as "createdAt",
        finished_at as "finishedAt"
      from job_runs
      order by created_at desc
      limit $1
    `,
    [limit],
  );

  return result.rows;
}

export async function getReferenceSummary() {
  const [promptCount, languageCount, locationCount, prompts, languages, locations] = await Promise.all([
    query<{ count: number }>("select count(*)::int as count from prompt_profiles"),
    query<{ count: number }>("select count(*)::int as count from languages"),
    query<{ count: number }>("select count(*)::int as count from locations"),
    query<{ title: string; slug: string }>("select title, slug from prompt_profiles order by title asc"),
    query<{ code: string; name: string }>("select code, name from languages order by name asc"),
    query<{ code: string; name: string; country_iso_code: string | null; location_type: string | null }>(
      `
        select code, name, country_iso_code, location_type
        from locations
        where location_type = 'Country'
        order by name asc
      `,
    ),
  ]);

  return {
    promptCount: promptCount.rows[0]?.count ?? 0,
    languageCount: languageCount.rows[0]?.count ?? 0,
    locationCount: locationCount.rows[0]?.count ?? 0,
    prompts: prompts.rows,
    languages: languages.rows,
    locations: locations.rows,
  };
}

