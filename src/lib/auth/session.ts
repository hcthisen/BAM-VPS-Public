import { getEnv } from "@/lib/env";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const SESSION_COOKIE_NAME = "bam_session";

export type SessionCookiePayload = {
  sid: string;
  uid: string;
  exp: number;
};

function toBase64Url(input: Uint8Array) {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function importSessionKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getEnv().BAM_MASTER_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionCookieValue(payload: SessionCookiePayload) {
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const payloadPart = toBase64Url(payloadBytes);
  const signature = await crypto.subtle.sign("HMAC", await importSessionKey(), encoder.encode(payloadPart));

  return `${payloadPart}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionCookieValue(cookieValue: string | undefined | null) {
  if (!cookieValue) {
    return null;
  }

  const [payloadPart, signaturePart] = cookieValue.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const isValid = await crypto.subtle.verify(
    "HMAC",
    await importSessionKey(),
    fromBase64Url(signaturePart),
    encoder.encode(payloadPart),
  );

  if (!isValid) {
    return null;
  }

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart))) as SessionCookiePayload;
    if (!payload.sid || !payload.uid || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
