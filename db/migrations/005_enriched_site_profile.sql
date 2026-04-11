-- Add structured profile components per BAM content process Steps A5-A7
alter table site_profiles
  add column if not exists avatar_map_json jsonb not null default '{}'::jsonb,
  add column if not exists topic_pillar_map_json jsonb not null default '[]'::jsonb,
  add column if not exists content_exclusions_json jsonb not null default '[]'::jsonb;

comment on column site_profiles.avatar_map_json is 'Primary/secondary audience personas with goals, pain points, knowledge level';
comment on column site_profiles.topic_pillar_map_json is '3-5 topic pillars with names, boundaries, and category mapping';
comment on column site_profiles.content_exclusions_json is 'Off-niche topics, banned phrases, risky claims to avoid';
