import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

import { parse } from "dotenv";

const envPath = path.join(process.cwd(), ".env");
const envExamplePath = path.join(process.cwd(), ".env.example");

function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {};
  }
  return parse(readFileSync(filePath, "utf8"));
}

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function deriveSupabaseUrl(appUrl: string) {
  try {
    const url = new URL(appUrl);
    url.port = "54321";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:54321";
  }
}

function ensureValue(env: Record<string, string>, key: string, nextValue: string) {
  if (!env[key] || env[key].trim() === "") {
    env[key] = nextValue;
  }
}

function signSupabaseToken(secret: string, role: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      role,
      iss: "bam-vps",
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function main() {
  const env = {
    ...readEnvFile(envExamplePath),
    ...readEnvFile(envPath),
  };

  ensureValue(env, "POSTGRES_PASSWORD", randomBase64Url(24));
  ensureValue(env, "BAM_APP_URL", env.BAM_APP_URL || "http://localhost:3000");
  ensureValue(env, "BAM_MASTER_KEY", randomBytes(32).toString("base64"));
  ensureValue(env, "BAM_SETUP_TOKEN", randomBase64Url(24));
  ensureValue(env, "SUPABASE_JWT_SECRET", randomBase64Url(48));
  ensureValue(env, "SUPABASE_ANON_KEY", signSupabaseToken(env.SUPABASE_JWT_SECRET, "anon"));
  ensureValue(env, "SUPABASE_SERVICE_ROLE_KEY", signSupabaseToken(env.SUPABASE_JWT_SECRET, "service_role"));
  if (!env.S3_SECRET_KEY && env.S3_SECRETE_KEY) {
    env.S3_SECRET_KEY = env.S3_SECRETE_KEY;
  }
  delete env.S3_SECRETE_KEY;
  env.SUPABASE_URL = deriveSupabaseUrl(env.BAM_APP_URL);
  env.DATABASE_URL = `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:54322/bam`;
  env.PGHOST = "localhost";
  env.PGPORT = "54322";
  env.PGDATABASE = "bam";
  env.PGUSER = "postgres";
  env.PGPASSWORD = env.POSTGRES_PASSWORD;
  ensureValue(env, "SUPABASE_STORAGE_BUCKET", "bam-media");

  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Bootstrap environment written to ${envPath}`);
}

main();
