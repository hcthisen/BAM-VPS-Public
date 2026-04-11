import { z } from "zod";

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/bam";
const DEFAULT_BAM_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const DEFAULT_BAM_SETUP_TOKEN = "development-setup-token";

const optionalString = () =>
  z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      return value;
    },
    z.string().min(1).optional(),
  );

const optionalUrl = () =>
  z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      return value;
    },
    z.string().url().optional(),
  );

const serverSchema = z.object({
  POSTGRES_PASSWORD: optionalString(),
  DATABASE_URL: z.string().min(1).default(DEFAULT_DATABASE_URL),
  PGHOST: optionalString(),
  PGPORT: optionalString(),
  PGDATABASE: optionalString(),
  PGUSER: optionalString(),
  PGPASSWORD: optionalString(),
  BAM_APP_URL: z.string().url().default("http://localhost:3000"),
  BAM_MASTER_KEY: z.string().min(1).default(DEFAULT_BAM_MASTER_KEY),
  BAM_SETUP_TOKEN: z.string().min(1).default(DEFAULT_BAM_SETUP_TOKEN),
  OPENAI_API_KEY: optionalString(),
  OPENAI_TEXT_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  OPENAI_WRITING_MODEL: z.string().min(1).default("gpt-5.4"),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1.5"),
  DATAFORSEO_LOGIN: optionalString(),
  DATAFORSEO_API_KEY: optionalString(),
  SUPABASE_URL: optionalUrl(),
  SUPABASE_JWT_SECRET: optionalString(),
  SUPABASE_ANON_KEY: optionalString(),
  SUPABASE_SERVICE_ROLE_KEY: optionalString(),
  SUPABASE_STORAGE_BUCKET: z.string().default("bam-media"),
  S3_REGION: optionalString(),
  S3_ACCESS_KEY: optionalString(),
  S3_SECRET_KEY: optionalString(),
  S3_SECRETE_KEY: optionalString(),
  S3_BUCKET: optionalString(),
  S3_ENDPOINT: optionalUrl(),
});

type ServerEnv = z.infer<typeof serverSchema>;

let cachedEnv: ServerEnv | null = null;

function normalizeProcessEnv(input: NodeJS.ProcessEnv) {
  const normalized = { ...input };

  if (!normalized.S3_SECRET_KEY && normalized.S3_SECRETE_KEY) {
    normalized.S3_SECRET_KEY = normalized.S3_SECRETE_KEY;
  }

  return normalized;
}

function assertProductionEnv(env: ServerEnv) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") {
    return;
  }

  const errors: string[] = [];

  if (env.DATABASE_URL === DEFAULT_DATABASE_URL) {
    errors.push("DATABASE_URL must be set in production.");
  }

  if (env.BAM_MASTER_KEY === DEFAULT_BAM_MASTER_KEY) {
    errors.push("BAM_MASTER_KEY must be generated in production.");
  }

  if (env.BAM_SETUP_TOKEN === DEFAULT_BAM_SETUP_TOKEN) {
    errors.push("BAM_SETUP_TOKEN must be generated in production.");
  }

  if (errors.length) {
    throw new Error(`Invalid production environment: ${errors.join(" ")}`);
  }
}

export function getEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsedEnv = serverSchema.parse(normalizeProcessEnv(process.env));
  assertProductionEnv(parsedEnv);
  cachedEnv = parsedEnv;
  return parsedEnv;
}

export function resetEnvForTests() {
  cachedEnv = null;
}

export function getEnvStatus() {
  const env = getEnv();

  return {
    appUrl: env.BAM_APP_URL,
    setupTokenConfigured: Boolean(env.BAM_SETUP_TOKEN),
    masterKeyConfigured: Boolean(env.BAM_MASTER_KEY),
    supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ANON_KEY),
  };
}

