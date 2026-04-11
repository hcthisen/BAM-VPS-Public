import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSessionCookieValue, SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { hashPassword, sha256, verifyPassword } from "@/lib/security";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AdminSession = {
  sessionId: string;
  adminUserId: string;
  email: string;
  expiresAt: string;
};

function buildCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: getEnv().BAM_APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function hasAdminUsers() {
  const result = await query<{ id: string }>("select id from admin_users limit 1");
  return (result.rowCount ?? 0) > 0;
}

async function persistSession(adminUserId: string) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const cookieValue = await createSessionCookieValue({
    sid: sessionId,
    uid: adminUserId,
    exp: expiresAt.getTime(),
  });

  await query(
    `
      insert into auth_sessions (id, admin_user_id, token_hash, expires_at, last_seen_at)
      values ($1, $2, $3, $4, now())
    `,
    [sessionId, adminUserId, sha256(cookieValue), expiresAt.toISOString()],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, buildCookieOptions(expiresAt));
}

export async function createInitialAdmin(email: string, password: string, setupToken: string) {
  if (setupToken !== getEnv().BAM_SETUP_TOKEN) {
    throw new Error("Invalid setup token.");
  }

  if (await hasAdminUsers()) {
    throw new Error("Initial admin has already been created.");
  }

  const passwordHash = await hashPassword(password);
  const result = await query<{ id: string }>(
    `
      insert into admin_users (email, password_hash)
      values ($1, $2)
      returning id
    `,
    [email.toLowerCase(), passwordHash],
  );

  await persistSession(result.rows[0].id);
  return result.rows[0].id;
}

export async function loginAdmin(email: string, password: string) {
  const result = await query<{ id: string; email: string; password_hash: string }>(
    `
      select id, email, password_hash
      from admin_users
      where lower(email) = lower($1)
      limit 1
    `,
    [email],
  );

  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new Error("Invalid email or password.");
  }

  await persistSession(user.id);
  return user.id;
}

export async function logoutAdmin() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionCookieValue(cookieValue);

  if (payload && cookieValue) {
    await query("update auth_sessions set revoked_at = now() where id = $1 and token_hash = $2", [
      payload.sid,
      sha256(cookieValue),
    ]);
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: getEnv().BAM_APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionCookieValue(cookieValue);

  if (!payload || !cookieValue) {
    return null;
  }

  const result = await query<AdminSession>(
    `
      select
        s.id as "sessionId",
        u.id as "adminUserId",
        u.email,
        s.expires_at as "expiresAt"
      from auth_sessions s
      join admin_users u on u.id = s.admin_user_id
      where s.id = $1
        and s.token_hash = $2
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1
    `,
    [payload.sid, sha256(cookieValue)],
  );

  const session = result.rows[0] ?? null;
  if (!session) {
    return null;
  }

  await query("update auth_sessions set last_seen_at = now() where id = $1", [session.sessionId]);
  return session;
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export function getGeneratedSupabaseConfig() {
  const env = getEnv();

  return {
    url: env.SUPABASE_URL ?? null,
    jwtSecret: env.SUPABASE_JWT_SECRET ?? null,
    anonKey: env.SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    storageBucket: env.SUPABASE_STORAGE_BUCKET,
    setupTokenPreview: `${env.BAM_SETUP_TOKEN.slice(0, 6)}...`,
    masterKeyPreview: `${env.BAM_MASTER_KEY.slice(0, 6)}...`,
  };
}
