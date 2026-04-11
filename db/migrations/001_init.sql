create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'site_status') then
    create type site_status as enum ('draft', 'active', 'paused', 'error');
  end if;

  if not exists (select 1 from pg_type where typname = 'content_kind') then
    create type content_kind as enum ('blog', 'news');
  end if;

  if not exists (select 1 from pg_type where typname = 'content_stage') then
    create type content_stage as enum (
      'queued',
      'research',
      'outline',
      'draft',
      'image_plan',
      'image_generation',
      'publish_pending',
      'published',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'item_status') then
    create type item_status as enum ('queued', 'running', 'ready', 'published', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type job_status as enum ('queued', 'running', 'succeeded', 'failed');
  end if;
end $$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists languages (
  code text primary key,
  name text not null,
  aitable_record_id text unique,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists locations (
  code text primary key,
  name text not null,
  parent_code text references locations(code) on delete set null,
  country_iso_code text,
  location_type text,
  aitable_record_id text unique,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prompt_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  prompt_template text not null default '',
  prompt_instructions text not null default '',
  outline_template text not null default '',
  title_template text not null default '',
  intro_template text not null default '',
  conclusion_template text not null default '',
  excerpt_template text not null default '',
  news_title_template text not null default '',
  news_rewrite_template text not null default '',
  aitable_record_id text unique,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  account_label text not null,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_name, account_label)
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  base_url text not null unique,
  wordpress_url text not null,
  language_code text references languages(code) on delete set null,
  location_code text references locations(code) on delete set null,
  status site_status not null default 'draft',
  posts_per_day integer not null default 1,
  news_per_day integer not null default 1,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_profiles (
  site_id uuid primary key references sites(id) on delete cascade,
  site_summary text,
  audience_summary text,
  tone_guide text,
  niche_summary text,
  profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_credentials (
  site_id uuid primary key references sites(id) on delete cascade,
  wordpress_username text,
  wordpress_application_password text,
  auth_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_settings (
  site_id uuid primary key references sites(id) on delete cascade,
  allow_blog boolean not null default true,
  allow_news boolean not null default true,
  article_generation_limit integer not null default 20,
  image_generation_limit integer not null default 100,
  timezone text not null default 'UTC',
  publishing_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_authors (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  wp_author_id bigint,
  name text not null,
  slug text,
  email text,
  usage_count integer not null default 0,
  active boolean not null default true,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name)
);

create table if not exists site_categories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  wp_category_id bigint,
  name text not null,
  slug text,
  description text,
  category_type text not null default 'content',
  usage_count integer not null default 0,
  active boolean not null default true,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name)
);

create table if not exists rss_feeds (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null unique,
  active boolean not null default true,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists site_rss_subscriptions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  feed_id uuid not null references rss_feeds(id) on delete cascade,
  category_id uuid references site_categories(id) on delete set null,
  category_label text,
  active boolean not null default true,
  poll_minutes integer not null default 60,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, feed_id)
);

create table if not exists rss_items (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references rss_feeds(id) on delete cascade,
  external_guid text,
  source_url text not null,
  title text not null,
  summary text,
  raw_content text,
  image_url text,
  published_at timestamptz,
  parsed_json jsonb not null default '{}'::jsonb,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_id, source_url),
  unique (feed_id, external_guid)
);

create table if not exists keyword_candidates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  category_id uuid references site_categories(id) on delete set null,
  keyword text not null,
  cluster_label text,
  source text not null default 'manual',
  search_volume integer,
  difficulty integer,
  used boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, keyword)
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind content_kind not null,
  stage content_stage not null default 'queued',
  status item_status not null default 'queued',
  title text,
  slug text,
  author_id uuid references site_authors(id) on delete set null,
  category_id uuid references site_categories(id) on delete set null,
  source_keyword_id uuid references keyword_candidates(id) on delete set null,
  source_rss_item_id uuid references rss_items(id) on delete set null,
  source_url text,
  seo_brief_json jsonb not null default '{}'::jsonb,
  outline_json jsonb not null default '[]'::jsonb,
  article_markdown text,
  excerpt text,
  faq_json jsonb not null default '[]'::jsonb,
  image_plan_json jsonb not null default '[]'::jsonb,
  publish_result_json jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  aitable_record_id text unique,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_sections (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  order_index integer not null,
  section_key text not null,
  heading text not null,
  goal text,
  body_markdown text,
  status item_status not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, section_key)
);

create table if not exists content_assets (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  role text not null,
  placement_key text not null,
  prompt text,
  alt_text text,
  source_kind text not null default 'generated',
  storage_path text,
  public_url text,
  openai_batch_id text,
  openai_file_id text,
  generation_status item_status not null default 'queued',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  boss_job_id text unique,
  queue_name text not null,
  status job_status not null default 'queued',
  target_type text,
  target_id text,
  message text,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists daily_usage_counters (
  counter_date date not null,
  metric text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (counter_date, metric)
);

create index if not exists idx_sites_status on sites(status);
create index if not exists idx_site_authors_site_id on site_authors(site_id);
create index if not exists idx_site_categories_site_id on site_categories(site_id);
create index if not exists idx_site_rss_subscriptions_site_id on site_rss_subscriptions(site_id);
create index if not exists idx_rss_items_feed_id on rss_items(feed_id);
create index if not exists idx_keyword_candidates_site_id on keyword_candidates(site_id);
create index if not exists idx_keyword_candidates_used on keyword_candidates(site_id, used);
create index if not exists idx_content_items_site_kind on content_items(site_id, kind);
create index if not exists idx_content_items_stage_status on content_items(stage, status);
create index if not exists idx_content_assets_content_item_id on content_assets(content_item_id);
create index if not exists idx_job_runs_status on job_runs(status, created_at desc);

drop trigger if exists trg_languages_updated_at on languages;
create trigger trg_languages_updated_at before update on languages for each row execute function set_updated_at();

drop trigger if exists trg_locations_updated_at on locations;
create trigger trg_locations_updated_at before update on locations for each row execute function set_updated_at();

drop trigger if exists trg_prompt_profiles_updated_at on prompt_profiles;
create trigger trg_prompt_profiles_updated_at before update on prompt_profiles for each row execute function set_updated_at();

drop trigger if exists trg_provider_accounts_updated_at on provider_accounts;
create trigger trg_provider_accounts_updated_at before update on provider_accounts for each row execute function set_updated_at();

drop trigger if exists trg_sites_updated_at on sites;
create trigger trg_sites_updated_at before update on sites for each row execute function set_updated_at();

drop trigger if exists trg_site_profiles_updated_at on site_profiles;
create trigger trg_site_profiles_updated_at before update on site_profiles for each row execute function set_updated_at();

drop trigger if exists trg_site_credentials_updated_at on site_credentials;
create trigger trg_site_credentials_updated_at before update on site_credentials for each row execute function set_updated_at();

drop trigger if exists trg_site_settings_updated_at on site_settings;
create trigger trg_site_settings_updated_at before update on site_settings for each row execute function set_updated_at();

drop trigger if exists trg_site_authors_updated_at on site_authors;
create trigger trg_site_authors_updated_at before update on site_authors for each row execute function set_updated_at();

drop trigger if exists trg_site_categories_updated_at on site_categories;
create trigger trg_site_categories_updated_at before update on site_categories for each row execute function set_updated_at();

drop trigger if exists trg_rss_feeds_updated_at on rss_feeds;
create trigger trg_rss_feeds_updated_at before update on rss_feeds for each row execute function set_updated_at();

drop trigger if exists trg_site_rss_subscriptions_updated_at on site_rss_subscriptions;
create trigger trg_site_rss_subscriptions_updated_at before update on site_rss_subscriptions for each row execute function set_updated_at();

drop trigger if exists trg_rss_items_updated_at on rss_items;
create trigger trg_rss_items_updated_at before update on rss_items for each row execute function set_updated_at();

drop trigger if exists trg_keyword_candidates_updated_at on keyword_candidates;
create trigger trg_keyword_candidates_updated_at before update on keyword_candidates for each row execute function set_updated_at();

drop trigger if exists trg_content_items_updated_at on content_items;
create trigger trg_content_items_updated_at before update on content_items for each row execute function set_updated_at();

drop trigger if exists trg_content_sections_updated_at on content_sections;
create trigger trg_content_sections_updated_at before update on content_sections for each row execute function set_updated_at();

drop trigger if exists trg_content_assets_updated_at on content_assets;
create trigger trg_content_assets_updated_at before update on content_assets for each row execute function set_updated_at();
