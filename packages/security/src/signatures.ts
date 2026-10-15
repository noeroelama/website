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
