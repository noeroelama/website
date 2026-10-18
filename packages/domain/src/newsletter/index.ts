import { z } from "zod";
import { safeText } from "@website/security/validation";
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

/** Who a campaign goes to. Only "all confirmed subscribers" exists today. */
export const CAMPAIGN_SEGMENTS = ["all"] as const;
export type CampaignSegment = (typeof CAMPAIGN_SEGMENTS)[number];
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

/** A newsletter campaign; the cron job "newsletter-send" delivers it in batches. */
export interface Campaign extends EntityMeta {
  readonly subject: string;
  /** Sanitised rich text (same allowlist as news). */
  readonly body: string;
  readonly segment: CampaignSegment;
  readonly status: CampaignStatus;
  readonly sendAt: Date | null;
  /** Last subscriber id handed to the messenger (batches resume after it). */
  readonly cursor: string | null;
  readonly sentCount: number;
  readonly sentAt: Date | null;
}

/** The campaign composer (draft). */
export const CampaignInputSchema = z
  .object({
    subject: safeText(200),
    body: z.string().max(200_000),
    segment: z.enum(CAMPAIGN_SEGMENTS),
  })
  .strict();
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

/** Send now (status sending) or schedule for a later time. */
export function sendState(
  sendAt: Date | null,
  now: Date,
): { status: "scheduled" | "sending"; sendAt: Date } {
  return sendAt !== null && sendAt > now
    ? { status: "scheduled", sendAt }
    : { status: "sending", sendAt: now };
}

/** Drafts and scheduled campaigns can be edited, sent or deleted; a sending or sent one cannot. */
export function canChangeCampaign(status: CampaignStatus): boolean {
  return status === "draft" || status === "scheduled";
}

/** What the cron job works on: a scheduled campaign whose time has come, or one already sending. */
export function isDue(campaign: Pick<Campaign, "status" | "sendAt">, now: Date): boolean {
  if (campaign.status === "sending") return true;
  return campaign.status === "scheduled" && campaign.sendAt !== null && campaign.sendAt <= now;
}

/** "s***@example.org" — subscriber lists for staff without newsletter.edit. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

/** Data signed into an unsubscribe link (`signLink`), used by web and admin alike. */
export function unsubscribeLinkData(subscriberId: string): { a: string; s: string } {
  return { a: "unsubscribe", s: subscriberId };
}
