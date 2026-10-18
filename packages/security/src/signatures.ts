import { createHmac, timingSafeEqual } from "node:crypto";

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * `Authorization: Bearer <secret>` check for cron routes, in constant time. An empty or missing
 * secret never matches.
 */
export function bearerTokenMatches(header: string | null, secret: string): boolean {
  if (!secret || header === null || !header.startsWith("Bearer ")) return false;
  return sameBytes(Buffer.from(header.slice("Bearer ".length)), Buffer.from(secret));
}

/**
 * Provider webhook signature: hex HMAC-SHA256 of `payload` (build it the way the provider
 * documents, e.g. `v0:{timestamp}:{body}`), optional prefix such as `v0=` or `sha256=`, compared
 * in constant time. With `timestamp` (seconds), requests older or newer than the tolerance are
 * refused (replay protection).
 */
export function verifyHmacSignature(input: {
  readonly payload: string;
  readonly signature: string | null;
  readonly secret: string;
  readonly prefix?: string;
  readonly timestamp?: string;
  readonly now: Date;
  readonly toleranceSeconds: number;
}): boolean {
  const { payload, signature, secret, prefix = "", timestamp, now, toleranceSeconds } = input;
  if (signature === null || !signature.startsWith(prefix)) return false;
  if (timestamp !== undefined) {
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(now.getTime() / 1000 - seconds) > toleranceSeconds) {
      return false;
    }
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  return sameBytes(Buffer.from(signature.slice(prefix.length), "hex"), expected);
}

/** Hex HMAC-SHA256 of `value` for one `purpose` (e.g. a document id from an e-mail address). */
export function keyedHash(purpose: string, value: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

const linkSignature = (body: string, secret: string) =>
  createHmac("sha256", secret).update(`link:${body}`).digest("base64url");

/**
 * Signed link token `<base64url JSON>.<base64url HMAC>` carrying a few strings (e.g. which
 * subscriber an unsubscribe link is for). Optional expiry. Nothing secret goes in `data`: it is
 * readable, only tamper-proof.
 */
export function signLink(
  data: Readonly<Record<string, string>>,
  secret: string,
  expiresAt?: Date,
): string {
  const payload = expiresAt ? { ...data, exp: String(expiresAt.getTime()) } : data;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${linkSignature(body, secret)}`;
}

/** The data of a valid, unexpired token from `signLink`, or null. */
export function verifyLink(
  token: string,
  secret: string,
  now: Date,
): Record<string, string> | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!sameBytes(Buffer.from(signature), Buffer.from(linkSignature(body, secret)))) return null;
  const data: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    !Object.values(data).every((v) => typeof v === "string")
  ) {
    return null;
  }
  const { exp, ...rest } = data as Record<string, string>;
  if (exp !== undefined && now.getTime() > Number(exp)) return null;
  return rest;
}
