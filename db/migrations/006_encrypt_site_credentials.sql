alter table site_credentials
  add column if not exists secrets_encrypted text;

comment on column site_credentials.secrets_encrypted is 'Encrypted per-site provider secrets. WordPress application passwords are stored here after application backfill.';
