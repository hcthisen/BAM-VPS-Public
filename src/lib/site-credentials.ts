import { query } from "@/lib/db";
import { decryptJson, encryptJson, maskSecretPreview } from "@/lib/security";

export type SiteCredentialsRow = {
  wordpress_username: string | null;
  wordpress_application_password: string | null;
  secrets_encrypted: string | null;
};

type SiteCredentialSecrets = {
  wordpressApplicationPassword?: string | null;
};

export type SiteWordPressCredentials = {
  wordpressUsername: string | null;
  wordpressApplicationPassword: string | null;
  hasWordPressApplicationPassword: boolean;
  wordpressApplicationPasswordPreview: string | null;
};

export function readWordPressApplicationPassword(row: SiteCredentialsRow | null | undefined) {
  if (!row) {
    return null;
  }

  const secrets = decryptJson<SiteCredentialSecrets>(row.secrets_encrypted, {});
  return secrets.wordpressApplicationPassword ?? row.wordpress_application_password ?? null;
}

export async function getSiteWordPressCredentials(siteId: string): Promise<SiteWordPressCredentials> {
  const result = await query<SiteCredentialsRow>(
    `
      select wordpress_username, wordpress_application_password, secrets_encrypted
      from site_credentials
      where site_id = $1
      limit 1
    `,
    [siteId],
  );

  const row = result.rows[0];
  const wordpressApplicationPassword = readWordPressApplicationPassword(row);

  return {
    wordpressUsername: row?.wordpress_username ?? null,
    wordpressApplicationPassword,
    hasWordPressApplicationPassword: Boolean(wordpressApplicationPassword),
    wordpressApplicationPasswordPreview: maskSecretPreview(wordpressApplicationPassword),
  };
}

export async function upsertSiteWordPressCredentials(
  siteId: string,
  wordpressUsername: string | null,
  nextApplicationPassword: string | null,
) {
  const existing = await getSiteWordPressCredentials(siteId);
  const wordpressApplicationPassword = nextApplicationPassword ?? existing.wordpressApplicationPassword;
  const secretsEncrypted = wordpressApplicationPassword
    ? encryptJson({ wordpressApplicationPassword })
    : null;

  await query(
    `
      insert into site_credentials (site_id, wordpress_username, wordpress_application_password, secrets_encrypted, auth_json)
      values ($1, $2, null, $3, '{}'::jsonb)
      on conflict (site_id) do update
      set wordpress_username = excluded.wordpress_username,
          wordpress_application_password = null,
          secrets_encrypted = excluded.secrets_encrypted,
          updated_at = now()
    `,
    [siteId, wordpressUsername, secretsEncrypted],
  );
}

export async function backfillEncryptedWordPressCredentials() {
  const rows = await query<{ site_id: string } & SiteCredentialsRow>(
    `
      select site_id, wordpress_username, wordpress_application_password, secrets_encrypted
      from site_credentials
      where wordpress_application_password is not null
         or (wordpress_application_password is null and secrets_encrypted is null)
    `,
  );

  let updated = 0;

  for (const row of rows.rows) {
    const wordpressApplicationPassword = readWordPressApplicationPassword(row);
    const secretsEncrypted = wordpressApplicationPassword
      ? encryptJson({ wordpressApplicationPassword })
      : null;

    await query(
      `
        update site_credentials
        set wordpress_application_password = null,
            secrets_encrypted = $2,
            updated_at = now()
        where site_id = $1
      `,
      [row.site_id, secretsEncrypted],
    );
    updated += 1;
  }

  return { updated };
}
