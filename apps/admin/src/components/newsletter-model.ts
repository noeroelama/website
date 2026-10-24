import {
  campaignRates,
  maskEmail,
  type Campaign,
  type CampaignStatus,
  type SubscriptionStatus,
} from "@website/domain/newsletter";
import type { Author } from "./authors";

/** A campaign row of the Newsletter page, mapped on the server from `campaigns/{id}`. */
export interface CampaignItem {
  id: string;
  version: number;
  subject: string;
  /** Sanitised HTML (shown in Preview and seeded into the composer). */
  body: string;
  status: CampaignStatus;
  /** ISO: scheduled or started time. */
  sendAt: string | null;
  sentAt: string | null;
  sentCount: number;
  openCount: number;
  clickCount: number;
  /** 0–1, null before anything was sent. */
  openRate: number | null;
  clickRate: number | null;
  modifiedAt: string;
  /** Whoever made the newest change (audit log), shown under the date. */
  author: Author | null;
}

/** A subscriber row; address and name are hidden unless the viewer has newsletter.edit. */
export interface SubscriberItem {
  id: string;
  email: string;
  /** Set by staff (Add / Import); null when unknown or hidden. */
  name: string | null;
  /** The PPI (chapter) name, set by staff. */
  ppi: string | null;
  status: SubscriptionStatus;
  /** ISO sign-up date. */
  subscribed: string;
  confirmedAt: string | null;
}

export function toCampaignItem(c: Campaign, author: Author | null = null): CampaignItem {
  const rates = campaignRates(c);
  return {
    id: c.id,
    version: c.version,
    subject: c.subject,
    body: c.body,
    status: c.status,
    sendAt: c.sendAt?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    sentCount: c.sentCount,
    openCount: c.openCount,
    clickCount: c.clickCount,
    openRate: rates.open,
    clickRate: rates.click,
    modifiedAt: c.updatedAt.toISOString(),
    author,
  };
}

export function toSubscriberItem(
  s: {
    id: string;
    email: string;
    name: string | null;
    status: SubscriptionStatus;
    createdAt: Date;
    confirmedAt: Date | null;
  },
  showEmail: boolean,
  ppi: string | null,
): SubscriberItem {
  return {
    id: s.id,
    email: showEmail ? s.email : maskEmail(s.email),
    name: showEmail ? s.name : null,
    ppi,
    status: s.status,
    subscribed: s.createdAt.toISOString(),
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
  };
}
