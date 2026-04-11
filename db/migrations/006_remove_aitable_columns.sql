-- Remove AITable migration-era tracking columns

alter table sites drop column if exists aitable_record_id;
alter table sites drop column if exists legacy_payload;

alter table site_authors drop column if exists aitable_record_id;
alter table site_authors drop column if exists legacy_payload;

alter table site_categories drop column if exists aitable_record_id;
alter table site_categories drop column if exists legacy_payload;

alter table rss_feeds drop column if exists aitable_record_id;
alter table rss_feeds drop column if exists legacy_payload;

alter table rss_items drop column if exists aitable_record_id;
alter table rss_items drop column if exists legacy_payload;

alter table keyword_candidates drop column if exists aitable_record_id;
alter table keyword_candidates drop column if exists legacy_payload;

alter table content_items drop column if exists aitable_record_id;
alter table content_items drop column if exists legacy_payload;

alter table languages drop column if exists aitable_record_id;
alter table languages drop column if exists source_created_at;
alter table languages drop column if exists source_updated_at;

alter table locations drop column if exists aitable_record_id;
alter table locations drop column if exists source_created_at;
alter table locations drop column if exists source_updated_at;

alter table prompt_profiles drop column if exists aitable_record_id;
alter table prompt_profiles drop column if exists source_created_at;
alter table prompt_profiles drop column if exists source_updated_at;
