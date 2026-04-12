alter table site_authors
  add column if not exists wordpress_role text;
