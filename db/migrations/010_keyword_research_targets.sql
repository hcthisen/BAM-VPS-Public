alter table site_settings
  add column if not exists keyword_max_difficulty integer;

alter table site_settings
  add column if not exists keyword_min_search_volume integer;

update site_settings
set keyword_max_difficulty = 40
where keyword_max_difficulty is null;

update site_settings
set keyword_min_search_volume = 100
where keyword_min_search_volume is null;

insert into site_settings (
  site_id,
  allow_blog,
  allow_news,
  auto_post,
  wordpress_post_status,
  image_density_pct,
  keyword_max_difficulty,
  keyword_min_search_volume
)
select
  s.id,
  false,
  false,
  false,
  'publish',
  100,
  40,
  100
from sites s
left join site_settings ss on ss.site_id = s.id
where ss.site_id is null
on conflict (site_id) do nothing;

alter table site_settings
  alter column keyword_max_difficulty set default 40;

alter table site_settings
  alter column keyword_max_difficulty set not null;

alter table site_settings
  alter column keyword_min_search_volume set default 100;

alter table site_settings
  alter column keyword_min_search_volume set not null;

alter table site_settings
  drop constraint if exists site_settings_keyword_max_difficulty_check;

alter table site_settings
  add constraint site_settings_keyword_max_difficulty_check
  check (keyword_max_difficulty between 0 and 100);

alter table site_settings
  drop constraint if exists site_settings_keyword_min_search_volume_check;

alter table site_settings
  add constraint site_settings_keyword_min_search_volume_check
  check (keyword_min_search_volume >= 0);
