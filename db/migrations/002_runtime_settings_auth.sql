create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table provider_accounts
  add column if not exists secrets_encrypted text;

alter table site_settings
  add column if not exists images_per_h2_section integer not null default 1;

alter table site_settings
  drop column if exists article_generation_limit;

alter table site_settings
  drop column if exists image_generation_limit;

drop trigger if exists trg_admin_users_updated_at on admin_users;
create trigger trg_admin_users_updated_at before update on admin_users for each row execute function set_updated_at();
