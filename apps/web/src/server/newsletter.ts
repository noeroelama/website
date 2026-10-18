import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FirestoreSubscriberStore } from "@website/db/firestore";
import type { Message } from "@website/domain/messaging";
import { NewsletterEmailSchema, OPTIN_TTL_MS } from "@website/domain/newsletter";
import { keyedHash, signLink, verifyLink } from "@website/security";
import { safeId } from "@website/security/validation";
import { DICTIONARIES, type Language } from "../i18n/dictionaries";

export interface NewsletterDeps {
  readonly store: Pick<FirestoreSubscriberStore, "startOptIn" | "confirm" | "unsubscribe">;
  /** reCAPTCHA v3, action "newsletter". */
  readonly captcha: (token: string) => Promise<boolean>;
  /** Messenger send; called after the transaction committed. */
  readonly send: (message: Message, key: string) => Promise<unknown>;
  /** Random, unguessable confirmation token (base64url). */
  readonly newToken: () => string;
  /** HMAC key for subscriber ids (never rotate: ids would change). */
  readonly hashSecret: string;
  /** HMAC key for unsubscribe links. */
  readonly linkSecret: string;
  readonly webUrl: string;
  readonly now: () => Date;
}

const SubscribeInput = z.object({ email: z.string().max(320), token: z.string().max(4000) });
const ConfirmInput = z.object({ s: safeId, t: z.string().min(1).max(200) });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Newsletter field (flowchart NEWSLETTER FIELD) with double opt-in. The answer to a valid sign-up
 * is always "check your inbox", whether the address is new, pending or confirmed. Subscriber ids
 * are keyed hashes, so the address never appears in URLs, keys or logs.
 */
export function createNewsletter(deps: NewsletterDeps) {
  const subscriberId = (email: string) => keyedHash("subscriber", email, deps.hashSecret);

  const unsubscribeUrl = (id: string) =>
    `${deps.webUrl}/newsletter/unsubscribe?t=${signLink({ a: "unsubscribe", s: id }, deps.linkSecret)}`;

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

    /** Every campaign e-mail carries this link (step 2.9). */
    unsubscribeUrl,

    async unsubscribe(linkToken: string): Promise<boolean> {
      const data = verifyLink(linkToken, deps.linkSecret, deps.now());
      const id = safeId.safeParse(data?.["s"]);
      if (data?.["a"] !== "unsubscribe" || !id.success) return false;
      return deps.store.unsubscribe(id.data, deps.now());
    },
  };
}
