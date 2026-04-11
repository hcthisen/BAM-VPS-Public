create table if not exists site_setup (
  site_id uuid primary key references sites(id) on delete cascade,
  setup_state text not null default 'needs_setup',
  basics_state text not null default 'pending',
  credentials_test_state text not null default 'untested',
  credentials_saved_at timestamptz,
  credentials_tested_at timestamptz,
  credentials_test_message text,
  wordpress_sync_state text not null default 'blocked',
  wordpress_sync_message text,
  profile_state text not null default 'blocked',
  profile_message text,
  keyword_state text not null default 'blocked',
  keyword_message text,
  initiated_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (setup_state in ('needs_setup', 'ready_to_initiate', 'initializing', 'ready', 'attention')),
  check (basics_state in ('blocked', 'pending', 'running', 'passed', 'failed')),
  check (credentials_test_state in ('untested', 'running', 'passed', 'failed')),
  check (wordpress_sync_state in ('blocked', 'pending', 'running', 'passed', 'failed')),
  check (profile_state in ('blocked', 'pending', 'running', 'passed', 'failed')),
  check (keyword_state in ('blocked', 'pending', 'running', 'passed', 'failed'))
);

alter table site_settings
  alter column allow_blog set default false;

alter table site_settings
  alter column allow_news set default false;

with site_backfill as (
  select
    s.id as site_id,
    case
      when s.language_code is not null and s.location_code is not null then 'passed'
      else 'pending'
    end as basics_state,
    case
      when sc.wordpress_username is not null and sc.wordpress_application_password is not null then sc.updated_at
      else null
    end as credentials_saved_at,
    case
      when exists (select 1 from site_authors sa where sa.site_id = s.id)
        or exists (select 1 from site_categories sca where sca.site_id = s.id)
        then 'passed'
      else 'blocked'
    end as wordpress_sync_state,
    case
      when coalesce(sp.site_summary, '') <> ''
        or coalesce(sp.audience_summary, '') <> ''
        or coalesce(sp.tone_guide, '') <> ''
        or coalesce(sp.niche_summary, '') <> ''
        then 'passed'
      else 'blocked'
    end as profile_state,
    case
      when exists (select 1 from keyword_candidates kc where kc.site_id = s.id) then 'passed'
      else 'blocked'
    end as keyword_state
  from sites s
  left join site_credentials sc on sc.site_id = s.id
  left join site_profiles sp on sp.site_id = s.id
)
insert into site_setup (
  site_id,
  setup_state,
  basics_state,
  credentials_test_state,
  credentials_saved_at,
  wordpress_sync_state,
  profile_state,
  keyword_state,
  ready_at
)
select
  site_id,
  case
    when wordpress_sync_state = 'passed' and profile_state = 'passed' and keyword_state = 'passed' then 'ready'
    when basics_state = 'passed' and credentials_saved_at is not null then 'ready_to_initiate'
    else 'needs_setup'
  end as setup_state,
  basics_state,
  'untested' as credentials_test_state,
  credentials_saved_at,
  wordpress_sync_state,
  profile_state,
  keyword_state,
  case
    when wordpress_sync_state = 'passed' and profile_state = 'passed' and keyword_state = 'passed' then now()
    else null
  end as ready_at
from site_backfill
on conflict (site_id) do nothing;

create index if not exists idx_site_setup_state on site_setup(setup_state);

drop trigger if exists trg_site_setup_updated_at on site_setup;
create trigger trg_site_setup_updated_at before update on site_setup for each row execute function set_updated_at();
