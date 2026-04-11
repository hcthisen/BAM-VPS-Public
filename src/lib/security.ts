import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/env";

function getMasterKey() {
  const raw = getEnv().BAM_MASTER_KEY.trim();

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to sha256 derivation.
  }

  return createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptJson<T>(ciphertext: string | null | undefined, fallback: T): T {
  if (!ciphertext) {
    return fallback;
  }

  try {
    const [ivPart, authTagPart, payloadPart] = ciphertext.split(".");
    if (!ivPart || !authTagPart || !payloadPart) {
      return fallback;
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getMasterKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadPart, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [scheme, saltPart, hashPart] = passwordHash.split(":");
  if (scheme !== "scrypt" || !saltPart || !hashPart) {
    return false;
  }

  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(hashPart, "base64url");
  const derived = scryptSync(password, salt, expected.length);

  return timingSafeEqual(derived, expected);
}

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskSecretPreview(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return `********${trimmed.slice(-4)}`;
}
