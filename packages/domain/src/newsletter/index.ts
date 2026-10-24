import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
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
  current: {
    status: SubscriptionStatus;
    tokenExpiresAt: Date | null;
    deletedAt?: Date | null;
  } | null,
  now: Date,
): "start" | "nothing" {
  // A subscriber deleted by staff starts over like a new address.
  if (current === null || current.deletedAt || current.status === "unsubscribed") return "start";
  if (current.status === "pending" && (current.tokenExpiresAt ?? now) <= now) return "start";
  return "nothing";
}

/**
 * Staff "Add New Subscriber" / "Import CSV": the same double opt-in, except that someone who
 * unsubscribed is never mailed again by staff (they can sign up again on the website).
 */
export function staffOptInDecision(
  current: {
    status: SubscriptionStatus;
    tokenExpiresAt: Date | null;
    deletedAt: Date | null;
  } | null,
  now: Date,
): "start" | "exists" | "unsubscribed" {
  if (current && !current.deletedAt && current.status === "unsubscribed") return "unsubscribed";
  return optInDecision(current, now) === "start" ? "start" : "exists";
}

/** Staff "Add New Subscriber": name and PPI (chapter) are optional, set by staff only. */
export const SubscriberInputSchema = z
  .object({
    email: NewsletterEmailSchema,
    name: safeText(120, { allowEmpty: true }),
    chapterId: safeId.nullable(),
  })
  .strict();
export type SubscriberInput = z.infer<typeof SubscriberInputSchema>;

/** Rows per "Import CSV" file (every new address gets its own opt-in e-mail). */
export const IMPORT_MAX_ROWS = 200;

/** One CSV line → fields ("" quoting, commas inside quotes). */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/**
 * "Import CSV": columns found by header name — `email` (required), `name`, `ppi` (the PPI's name);
 * others are ignored, so an exported file can be imported again. `invalid` lists the file line
 * numbers (1 = header) whose address is not valid. One record per line.
 */
export function parseSubscriberCsv(
  text: string,
):
  | { ok: true; rows: { email: string; name: string; ppi: string }[]; invalid: number[] }
  | { ok: false; error: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  // split() always returns at least one line (the header, maybe empty).
  const header = csvFields(String(lines[0])).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("email") < 0) return { ok: false, error: 'The file needs an "email" column.' };
  const body = lines.slice(1).map((line, i) => ({ line, n: i + 2 }));
  const filled = body.filter(({ line }) => line.trim() !== "");
  if (filled.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `Import at most ${IMPORT_MAX_ROWS} rows per file.` };
  }
  const rows: { email: string; name: string; ppi: string }[] = [];
  const invalid: number[] = [];
  for (const { line, n } of filled) {
    const fields = csvFields(line);
    const at = (name: string) => (col(name) < 0 ? "" : (fields[col(name)] ?? ""));
    const email = NewsletterEmailSchema.safeParse(at("email"));
    const name = safeText(120, { allowEmpty: true }).safeParse(at("name"));
    if (!email.success || !name.success) invalid.push(n);
    else rows.push({ email: email.data, name: name.data, ppi: at("ppi") });
  }
  return { ok: true, rows, invalid };
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
  /** Subscribers who opened / clicked at least once (web /newsletter/o and /newsletter/c). */
  readonly openCount: number;
  readonly clickCount: number;
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

/** Drafts and scheduled campaigns can be edited or sent; a sending or sent one cannot. */
export function canChangeCampaign(status: CampaignStatus): boolean {
  return status === "draft" || status === "scheduled";
}

/** Anything but a campaign that is being sent can be deleted (soft delete, revertible). */
export function canDeleteCampaign(status: CampaignStatus): boolean {
  return status !== "sending";
}

/** The public archive page (web /newsletter/{id}) shows campaigns that went out. */
export function isPublicCampaign(campaign: Pick<Campaign, "status" | "deletedAt">): boolean {
  return (campaign.status === "sent" || campaign.status === "sending") && !campaign.deletedAt;
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

export type TrackingKind = "open" | "click";

/** Data signed into an open-pixel or click link (`signLink`, LINK_SIGNING_SECRET, no expiry). */
export function trackingLinkData(
  kind: TrackingKind,
  campaignId: string,
  subscriberId: string,
  url?: string,
): Record<string, string> {
  return {
    a: kind === "open" ? "o" : "c",
    c: campaignId,
    s: subscriberId,
    ...(url === undefined ? {} : { u: url }),
  };
}

/** The verified data of a tracking link, or null (a click needs an http(s) address). */
export function readTrackingLink(data: Record<string, string> | null): {
  kind: TrackingKind;
  campaignId: string;
  subscriberId: string;
  url: string | null;
} | null {
  if (!data || (data["a"] !== "o" && data["a"] !== "c")) return null;
  const campaignId = safeId.safeParse(data["c"]);
  const subscriberId = safeId.safeParse(data["s"]);
  if (!campaignId.success || !subscriberId.success) return null;
  const kind = data["a"] === "o" ? "open" : "click";
  const url = data["u"] ?? null;
  if (kind === "click" && (url === null || !/^https?:\/\//i.test(url))) return null;
  return {
    kind,
    campaignId: campaignId.data,
    subscriberId: subscriberId.data,
    url: kind === "click" ? url : null,
  };
}

/** Every http(s) link of sanitised campaign HTML, rewritten by `wrap` (click tracking). */
export function trackLinks(html: string, wrap: (url: string) => string): string {
  return html.replace(
    /href="(https?:\/\/[^"]*)"/gi,
    (_, url: string) => `href="${wrap(url.replace(/&amp;/g, "&")).replace(/&/g, "&amp;")}"`,
  );
}

const rate = (count: number, sent: number) => (sent > 0 ? count / sent : null);

/** Open and click rate of one campaign (0–1), null before anything was sent. */
export function campaignRates(c: Pick<Campaign, "sentCount" | "openCount" | "clickCount">): {
  open: number | null;
  click: number | null;
} {
  return { open: rate(c.openCount, c.sentCount), click: rate(c.clickCount, c.sentCount) };
}

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * "Avg. open/click rate · last 5": the mean rate of the newest `window` sent campaigns that
 * reached someone, and its change (0–1 points) against the `window` sent before them.
 */
export function recentRates(
  campaigns: readonly Pick<
    Campaign,
    "status" | "sentAt" | "sentCount" | "openCount" | "clickCount"
  >[],
  window = 5,
): {
  open: number | null;
  click: number | null;
  openDelta: number | null;
  clickDelta: number | null;
} {
  const sent = campaigns
    .filter((c) => c.status === "sent" && c.sentAt !== null && c.sentCount > 0)
    .sort((a, b) => Number(b.sentAt) - Number(a.sentAt));
  const avg = (list: typeof sent, key: "openCount" | "clickCount") =>
    mean(list.map((c) => c[key] / c.sentCount));
  const last = sent.slice(0, window);
  const before = sent.slice(window, window * 2);
  const delta = (key: "openCount" | "clickCount") => {
    const now = avg(last, key);
    const then = avg(before, key);
    return now === null || then === null ? null : now - then;
  };
  return {
    open: avg(last, "openCount"),
    click: avg(last, "clickCount"),
    openDelta: delta("openCount"),
    clickDelta: delta("clickCount"),
  };
}

/** "Active subscribers" (who would get a campaign now) and how many confirmed this UTC month. */
export function subscriberStats(
  rows: readonly Pick<Subscriber, "status" | "confirmedAt" | "deletedAt">[],
  now: Date,
): { active: number; thisMonth: number } {
  const month = now.toISOString().slice(0, 7);
  const active = rows.filter(canReceiveCampaigns);
  return {
    active: active.length,
    thisMonth: active.filter((r) => r.confirmedAt?.toISOString().slice(0, 7) === month).length,
  };
}
