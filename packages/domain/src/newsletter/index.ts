import { z } from "zod";
import type { EntityMeta } from "../shared";

export type SubscriptionStatus = "pending" | "confirmed" | "unsubscribed" | "suppressed";

export interface Subscriber extends EntityMeta {
  readonly email: string;
  readonly status: SubscriptionStatus;
  readonly confirmedAt: Date | null;
}

/** Double opt-in: only confirmed, non-suppressed subscribers may receive campaigns. */
export function canReceiveCampaigns(subscriber: Pick<Subscriber, "status" | "deletedAt">): boolean {
  return subscriber.status === "confirmed" && subscriber.deletedAt === null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Abuse-prevention port (reCAPTCHA today). Fail-open vs fail-closed is decided by the caller. */
export interface CaptchaVerifier {
  verify(
    token: string,
    expectedAction: string,
  ): Promise<{ success: boolean; score: number | null }>;
}

/** The sign-up field: trimmed, lower-cased, a plain e-mail address. */
export const NewsletterEmailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email("Enter a valid e-mail address.").max(254));

/** How long a confirmation link works. */
export const OPTIN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Sign-up: write a pending record and send the confirmation e-mail ("start"), or do nothing.
 * The visitor sees the same "check your inbox" answer either way, so nobody can find out whether
 * an address is subscribed.
 */
export function optInDecision(
  current: { status: SubscriptionStatus; tokenExpiresAt: Date | null } | null,
  now: Date,
): "start" | "nothing" {
  if (current === null || current.status === "unsubscribed") return "start";
  if (current.status === "pending" && (current.tokenExpiresAt ?? now) <= now) return "start";
  return "nothing";
}

/** Confirmation link: the token works once, only while pending and before it expires. */
export function confirmDecision(
  current: {
    status: SubscriptionStatus;
    tokenHash: string | null;
    tokenExpiresAt: Date | null;
  } | null,
  tokenHash: string,
  now: Date,
): "confirmed" | "expired" | "invalid" {
  if (current?.status !== "pending" || current.tokenHash !== tokenHash) return "invalid";
  return (current.tokenExpiresAt ?? now) <= now ? "expired" : "confirmed";
}
