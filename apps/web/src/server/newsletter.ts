import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SqlCampaignWebStore, SqlSubscriberStore } from "@website/db/sql";
import type { Message } from "@website/domain/messaging";
import {
  NewsletterEmailSchema,
  OPTIN_TTL_MS,
  readTrackingLink,
  unsubscribeLinkData,
  type Campaign,
} from "@website/domain/newsletter";
import { keyedHash, signLink, verifyLink } from "@website/security";
import { safeId } from "@website/security/validation";
import { DICTIONARIES, type Language } from "../i18n/dictionaries";

export interface NewsletterDeps {
  readonly store: Pick<SqlSubscriberStore, "startOptIn" | "confirm" | "unsubscribe">;
  readonly campaigns: Pick<SqlCampaignWebStore, "findPublic" | "track">;
  readonly onTrackError: (error: unknown) => void;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly newToken: () => string;
  readonly hashSecret: string;
  readonly linkSecret: string;
  readonly webUrl: string;
  readonly now: () => Date;
}

const SubscribeInput = z.object({ email: z.string().max(320), token: z.string().max(4000) });
const ConfirmInput = z.object({ s: safeId, t: z.string().min(1).max(200) });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function createNewsletter(deps: NewsletterDeps) {
  const subscriberId = (email: string) => keyedHash("subscriber", email, deps.hashSecret);

  const unsubscribeUrl = (id: string) =>
    `${deps.webUrl}/newsletter/unsubscribe?t=${signLink(unsubscribeLinkData(id), deps.linkSecret)}`;

  const record = async (linkToken: string, kind: "open" | "click"): Promise<string | null> => {
    const link = readTrackingLink(verifyLink(linkToken, deps.linkSecret, deps.now()));
    if (link?.kind !== kind) return null;
    try {
      await deps.campaigns.track(kind, link.campaignId, link.subscriberId, deps.now());
    } catch (error) {
      deps.onTrackError(error);
    }
    return link.url;
  };

  return {
    async subscribe(
      input: unknown,
      language: Language,
    ): Promise<{ ok: true } | { ok: false; error: "invalid" | "captcha" }> {
      const parsed = SubscribeInput.safeParse(input);
      const email = NewsletterEmailSchema.safeParse(parsed.data?.email);
      if (!parsed.success || !email.success) return { ok: false, error: "invalid" };
      if (!(await deps.captcha(parsed.data.token))) return { ok: false, error: "captcha" };
      const id = subscriberId(email.data);
      const token = deps.newToken();
      const now = deps.now();
      const started = await deps.store.startOptIn(
        id,
        email.data,
        sha256(token),
        new Date(now.getTime() + OPTIN_TTL_MS),
        now,
      );
      if (started) {
        const t = DICTIONARIES[language].newsletter;
        const link = `${deps.webUrl}/newsletter/confirm?s=${id}&t=${token}`;
        await deps.send(
          {
            channel: "email",
            to: email.data,
            subject: t.mailSubject,
            text: `${t.mailBody}\n\n${link}\n\n${t.mailIgnore}`,
            html: `<p>${t.mailBody}</p><p><a href="${link}">${t.mailButton}</a></p><p>${t.mailIgnore}</p>`,
          },
          `newsletter:${id}:optin:${started.optIn}`,
        );
      }
      return { ok: true };
    },

    async confirm(input: unknown): Promise<"confirmed" | "expired" | "invalid"> {
      const parsed = ConfirmInput.safeParse(input);
      if (!parsed.success) return "invalid";
      return deps.store.confirm(parsed.data.s, sha256(parsed.data.t), deps.now());
    },

    unsubscribeUrl,

    publicCampaign(id: string): Promise<Campaign | null> {
      return deps.campaigns.findPublic(id);
    },

    async trackOpen(linkToken: string): Promise<void> {
      await record(linkToken, "open");
    },

    async trackClick(linkToken: string): Promise<string | null> {
      return record(linkToken, "click");
    },

    async unsubscribe(linkToken: string): Promise<boolean> {
      const data = verifyLink(linkToken, deps.linkSecret, deps.now());
      const id = safeId.safeParse(data?.["s"]);
      if (data?.["a"] !== "unsubscribe" || !id.success) return false;
      return deps.store.unsubscribe(id.data, deps.now());
    },
  };
}
