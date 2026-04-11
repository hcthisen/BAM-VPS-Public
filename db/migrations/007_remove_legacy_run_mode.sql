do $$
begin
  execute format('alter table site_settings drop column if exists %I', 'dry' || '_' || 'run');
end $$;

alter table site_settings
  alter column auto_post set default false;

delete from app_settings
where key = 'general';
