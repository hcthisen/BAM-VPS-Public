import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { decryptJson, encryptJson, maskSecretPreview } from "@/lib/security";

type ProviderAccountRow = {
  config_json: Record<string, unknown> | null;
  secrets_encrypted: string | null;
};

export type OpenAiSettings = {
  apiKey: string | null;
  apiKeyPreview: string | null;
  textModel: string;
  writingModel: string;
  imageModel: string;
};

export type DataForSeoSettings = {
  login: string | null;
  apiKey: string | null;
  apiKeyPreview: string | null;
};

export type S3Settings = {
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKey: string | null;
  accessKeyPreview: string | null;
  secretKey: string | null;
  secretKeyPreview: string | null;
};

type OpenAiSettingsSummary = Omit<OpenAiSettings, "apiKey"> & {
  apiKeyConfigured: boolean;
};

type DataForSeoSettingsSummary = Omit<DataForSeoSettings, "apiKey"> & {
  apiKeyConfigured: boolean;
};

type S3SettingsSummary = Omit<S3Settings, "accessKey" | "secretKey"> & {
  accessKeyConfigured: boolean;
  secretKeyConfigured: boolean;
};

export type SettingsPageSummary = {
  openai: OpenAiSettingsSummary;
  dataforseo: DataForSeoSettingsSummary;
  s3: S3SettingsSummary;
};

async function getProviderAccount(providerName: string, accountLabel = "default") {
  const result = await query<ProviderAccountRow>(
    `
      select config_json, secrets_encrypted
      from provider_accounts
      where provider_name = $1 and account_label = $2
      limit 1
    `,
    [providerName, accountLabel],
  );

  const row = result.rows[0];
  return {
    config: (row?.config_json ?? {}) as Record<string, unknown>,
    secrets: decryptJson<Record<string, unknown>>(row?.secrets_encrypted, {}),
  };
}

export async function upsertProviderAccount(
  providerName: string,
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
  accountLabel = "default",
) {
  const existing = await getProviderAccount(providerName, accountLabel);
  const nextSecrets = { ...existing.secrets };

  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === "string" && value.trim()) {
      nextSecrets[key] = value;
    }
  }

  await query(
    `
      insert into provider_accounts (provider_name, account_label, config_json, secrets_encrypted)
      values ($1, $2, $3, $4)
      on conflict (provider_name, account_label) do update
      set config_json = excluded.config_json,
          secrets_encrypted = excluded.secrets_encrypted,
          updated_at = now()
    `,
    [providerName, accountLabel, JSON.stringify(config), encryptJson(nextSecrets)],
  );
}

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  const result = await query<{ value_json: T }>("select value_json from app_settings where key = $1 limit 1", [key]);
  return result.rows[0]?.value_json ?? fallback;
}

export async function setAppSetting(key: string, value: unknown) {
  await query(
    `
      insert into app_settings (key, value_json, updated_at)
      values ($1, $2, now())
      on conflict (key) do update
      set value_json = excluded.value_json,
          updated_at = now()
    `,
    [key, JSON.stringify(value)],
  );
}

export async function getOpenAiSettings(): Promise<OpenAiSettings> {
  const env = getEnv();
  const account = await getProviderAccount("openai");
  const apiKey = (account.secrets.apiKey as string | undefined) ?? env.OPENAI_API_KEY ?? null;
  return {
    apiKey,
    apiKeyPreview: maskSecretPreview(apiKey),
    textModel: (account.config.textModel as string | undefined) ?? env.OPENAI_TEXT_MODEL,
    writingModel: (account.config.writingModel as string | undefined) ?? env.OPENAI_WRITING_MODEL,
    imageModel: (account.config.imageModel as string | undefined) ?? env.OPENAI_IMAGE_MODEL,
  };
}

export async function getDataForSeoSettings(): Promise<DataForSeoSettings> {
  const env = getEnv();
  const account = await getProviderAccount("dataforseo");
  const apiKey = (account.secrets.apiKey as string | undefined) ?? env.DATAFORSEO_API_KEY ?? null;
  return {
    login: (account.secrets.login as string | undefined) ?? env.DATAFORSEO_LOGIN ?? null,
    apiKey,
    apiKeyPreview: maskSecretPreview(apiKey),
  };
}

export async function getS3Settings(): Promise<S3Settings> {
  const env = getEnv();
  const account = await getProviderAccount("s3");
  const accessKey = (account.secrets.accessKey as string | undefined) ?? env.S3_ACCESS_KEY ?? null;
  const secretKey =
    (account.secrets.secretKey as string | undefined) ??
    env.S3_SECRET_KEY ??
    env.S3_SECRETE_KEY ??
    null;

  return {
    endpoint: (account.config.endpoint as string | undefined) ?? env.S3_ENDPOINT ?? null,
    region: (account.config.region as string | undefined) ?? env.S3_REGION ?? null,
    bucket: (account.config.bucket as string | undefined) ?? env.S3_BUCKET ?? null,
    accessKey,
    accessKeyPreview: maskSecretPreview(accessKey),
    secretKey,
    secretKeyPreview: maskSecretPreview(secretKey),
  };
}

export async function getSettingsPageSummary(): Promise<SettingsPageSummary> {
  const [openai, dataforseo, s3] = await Promise.all([
    getOpenAiSettings(),
    getDataForSeoSettings(),
    getS3Settings(),
  ]);

  return {
    openai: {
      apiKeyConfigured: Boolean(openai.apiKey),
      apiKeyPreview: openai.apiKeyPreview,
      textModel: openai.textModel,
      writingModel: openai.writingModel,
      imageModel: openai.imageModel,
    },
    dataforseo: {
      login: dataforseo.login,
      apiKeyConfigured: Boolean(dataforseo.apiKey),
      apiKeyPreview: dataforseo.apiKeyPreview,
    },
    s3: {
      endpoint: s3.endpoint,
      region: s3.region,
      bucket: s3.bucket,
      accessKeyConfigured: Boolean(s3.accessKey),
      accessKeyPreview: s3.accessKeyPreview,
      secretKeyConfigured: Boolean(s3.secretKey),
      secretKeyPreview: s3.secretKeyPreview,
    },
  };
}
