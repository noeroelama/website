import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import type { EntityMeta } from "../shared";

export type SubscriptionStatus = "pending" | "confirmed" | "unsubscribed" | "suppressed";

export interface Subscriber extends EntityMeta {
  readonly email: string;
  readonly status: SubscriptionStatus;
  readonly confirmedAt: Date | null;
}

export function canReceiveCampaigns(subscriber: Pick<Subscriber, "status" | "deletedAt">): boolean {
  return subscriber.status === "confirmed" && subscriber.deletedAt === null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CaptchaVerifier {
  verify(
    token: string,
    expectedAction: string,
  ): Promise<{ success: boolean; score: number | null }>;
}

export const NewsletterEmailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email("Enter a valid e-mail address.").max(254));

export const OPTIN_TTL_MS = 48 * 60 * 60 * 1000;

export function optInDecision(
  current: {
    status: SubscriptionStatus;
    tokenExpiresAt: Date | null;
    deletedAt?: Date | null;
  } | null,
  now: Date,
): "start" | "nothing" {
  if (current === null || current.deletedAt || current.status === "unsubscribed") return "start";
  if (current.status === "pending" && (current.tokenExpiresAt ?? now) <= now) return "start";
  return "nothing";
}

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

export const SubscriberInputSchema = z
  .object({
    email: NewsletterEmailSchema,
    name: safeText(120, { allowEmpty: true }),
    chapterId: safeId.nullable(),
  })
  .strict();
export type SubscriberInput = z.infer<typeof SubscriberInputSchema>;

export const IMPORT_MAX_ROWS = 200;

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

export function parseSubscriberCsv(
  text: string,
):
  | { ok: true; rows: { email: string; name: string; ppi: string }[]; invalid: number[] }
  | { ok: false; error: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
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

export const CAMPAIGN_SEGMENTS = ["all"] as const;
export type CampaignSegment = (typeof CAMPAIGN_SEGMENTS)[number];
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

export interface Campaign extends EntityMeta {
  readonly subject: string;
  readonly body: string;
  readonly segment: CampaignSegment;
  readonly status: CampaignStatus;
  readonly sendAt: Date | null;
  readonly cursor: string | null;
  readonly sentCount: number;
  readonly sentAt: Date | null;
  readonly openCount: number;
  readonly clickCount: number;
}

export const CampaignInputSchema = z
  .object({
    subject: safeText(200),
    body: z.string().max(200_000),
    segment: z.enum(CAMPAIGN_SEGMENTS),
  })
  .strict();
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export function sendState(
  sendAt: Date | null,
  now: Date,
): { status: "scheduled" | "sending"; sendAt: Date } {
  return sendAt !== null && sendAt > now
    ? { status: "scheduled", sendAt }
    : { status: "sending", sendAt: now };
}

export function canChangeCampaign(status: CampaignStatus): boolean {
  return status === "draft" || status === "scheduled";
}

export function canDeleteCampaign(status: CampaignStatus): boolean {
  return status !== "sending";
}

export function isPublicCampaign(campaign: Pick<Campaign, "status" | "deletedAt">): boolean {
  return (campaign.status === "sent" || campaign.status === "sending") && !campaign.deletedAt;
}

export function isDue(campaign: Pick<Campaign, "status" | "sendAt">, now: Date): boolean {
  if (campaign.status === "sending") return true;
  return campaign.status === "scheduled" && campaign.sendAt !== null && campaign.sendAt <= now;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

export function unsubscribeLinkData(subscriberId: string): { a: string; s: string } {
  return { a: "unsubscribe", s: subscriberId };
}

export type TrackingKind = "open" | "click";

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

export function trackLinks(html: string, wrap: (url: string) => string): string {
  return html.replace(
    /href="(https?:\/\/[^"]*)"/gi,
    (_, url: string) => `href="${wrap(url.replace(/&amp;/g, "&")).replace(/&/g, "&amp;")}"`,
  );
}

const rate = (count: number, sent: number) => (sent > 0 ? count / sent : null);

export function campaignRates(c: Pick<Campaign, "sentCount" | "openCount" | "clickCount">): {
  open: number | null;
  click: number | null;
} {
  return { open: rate(c.openCount, c.sentCount), click: rate(c.clickCount, c.sentCount) };
}

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

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
