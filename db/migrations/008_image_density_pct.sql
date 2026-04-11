alter table site_settings
  add column if not exists image_density_pct integer;

update site_settings
set image_density_pct = case
  when image_density_pct in (25, 30, 50, 75, 100) then image_density_pct
  when coalesce(images_per_h2_section, 1) <= 1 then 100
  when images_per_h2_section = 2 then 50
  when images_per_h2_section = 3 then 30
  else 25
end;

update site_settings
set image_density_pct = 100
where image_density_pct is null;

alter table site_settings
  alter column image_density_pct set default 100;

alter table site_settings
  alter column image_density_pct set not null;

alter table site_settings
  drop constraint if exists site_settings_image_density_pct_check;

alter table site_settings
  add constraint site_settings_image_density_pct_check
  check (image_density_pct in (25, 30, 50, 75, 100));

alter table site_settings
  drop column if exists images_per_h2_section;
