alter table site_settings
  add column if not exists auto_post boolean not null default false;

alter table site_settings
  add column if not exists wordpress_post_status text not null default 'publish';

update site_settings
set wordpress_post_status = case
  when lower(coalesce(wordpress_post_status, 'publish')) = 'draft' then 'draft'
  else 'publish'
end;
