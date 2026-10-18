import {
  maskEmail,
  type Campaign,
  type CampaignStatus,
  type SubscriptionStatus,
} from "@website/domain/newsletter";

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
  modifiedAt: string;
}

/** A subscriber row; the address is masked unless the viewer has newsletter.edit. */
export interface SubscriberItem {
  id: string;
  email: string;
  status: SubscriptionStatus;
  /** ISO sign-up date. */
  subscribed: string;
  confirmedAt: string | null;
}

export function toCampaignItem(c: Campaign): CampaignItem {
  return {
    id: c.id,
    version: c.version,
    subject: c.subject,
    body: c.body,
    status: c.status,
    sendAt: c.sendAt?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    sentCount: c.sentCount,
    modifiedAt: c.updatedAt.toISOString(),
  };
}

export function toSubscriberItem(
  s: {
    id: string;
    email: string;
    status: SubscriptionStatus;
    createdAt: Date;
    confirmedAt: Date | null;
  },
  showEmail: boolean,
): SubscriberItem {
  return {
    id: s.id,
    email: showEmail ? s.email : maskEmail(s.email),
    status: s.status,
    subscribed: s.createdAt.toISOString(),
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
  };
}
