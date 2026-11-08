import {
  campaignRates,
  maskEmail,
  type Campaign,
  type CampaignStatus,
  type SubscriptionStatus,
} from "@website/domain/newsletter";
import type { Author } from "./authors";

export interface CampaignItem {
  id: string;
  version: number;
  subject: string;
  body: string;
  status: CampaignStatus;
  sendAt: string | null;
  sentAt: string | null;
  sentCount: number;
  openCount: number;
  clickCount: number;
  openRate: number | null;
  clickRate: number | null;
  modifiedAt: string;
  author: Author | null;
}

export interface SubscriberItem {
  id: string;
  email: string;
  name: string | null;
  ppi: string | null;
  status: SubscriptionStatus;
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
