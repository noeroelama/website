import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const API_SCOPES = ["events.read", "registrations.write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type KeyEnvironment = "live" | "test";

const KEY_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const KEY_PATTERN = /^pk_(live|test)_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export interface ApiKeyRecord {
  readonly keyId: string;
  readonly clientId: string;
  readonly environment: KeyEnvironment;
  readonly secretHash: string;
  readonly scopes: readonly ApiScope[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly rateLimitPerMinute: number | null;
}

export interface ApiKeyStore {
  findByKeyId(keyId: string): Promise<ApiKeyRecord | null>;
}

export function hashSecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("base64url");
}

export function generateApiKey(environment: KeyEnvironment, pepper: string) {
  const keyId = Array.from(
    randomBytes(12),
    (byte) => KEY_ID_ALPHABET[byte % KEY_ID_ALPHABET.length],
  ).join("");
  const secret = randomBytes(32).toString("base64url");
  return {
    plaintext: `pk_${environment}_${keyId}_${secret}`,
    keyId,
    secretHash: hashSecret(secret, pepper),
  };
}

export function parseApiKey(
  raw: string,
): { environment: KeyEnvironment; keyId: string; secret: string } | null {
  const match = KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, environment, keyId, secret] = match;
  if (!environment || !keyId || !secret) return null;
  return { environment: environment as KeyEnvironment, keyId, secret };
}

export type ApiKeyVerification =
  | { readonly ok: true; readonly key: ApiKeyRecord }
  | {
      readonly ok: false;
      readonly reason: "malformed" | "unknown" | "revoked" | "expired" | "wrong_environment";
    };

export async function verifyApiKey(input: {
  raw: string;
  store: ApiKeyStore;
  pepper: string;
  expectedEnvironment: KeyEnvironment;
  now: Date;
}): Promise<ApiKeyVerification> {
  const parsed = parseApiKey(input.raw);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.environment !== input.expectedEnvironment)
    return { ok: false, reason: "wrong_environment" };
  const record = await input.store.findByKeyId(parsed.keyId);
  if (!record) return { ok: false, reason: "unknown" };
  const expected = Buffer.from(record.secretHash);
  const actual = Buffer.from(hashSecret(parsed.secret, input.pepper));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "unknown" };
  }
  if (record.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (record.expiresAt !== null && record.expiresAt <= input.now)
    return { ok: false, reason: "expired" };
  return { ok: true, key: record };
}

export function hasScope(key: Pick<ApiKeyRecord, "scopes">, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}
