import "server-only";
import { z } from "zod";
import type { Message } from "@website/domain/messaging";
import type { PublicEvent, RegistrationStatus } from "@website/domain/events";
import { isValidSlug, RuleViolationError } from "@website/domain/shared";
import { DICTIONARIES, type Language } from "../i18n/dictionaries";

export interface RegistrationDeps {
  readonly findEvent: (slug: string) => Promise<PublicEvent | null>;
  readonly register: (
    eventId: string,
    userId: string,
    now: Date,
  ) => Promise<{ status: RegistrationStatus; created: boolean }>;
  /** reCAPTCHA v3, action "event_register". */
  readonly captcha: (token: string) => Promise<boolean>;
  /** Messenger send; called after the registration transaction committed. */
  readonly send: (message: Message, key: string) => Promise<unknown>;
  /** Member-only: a complete profile (isProfileComplete) is required to register (B3). */
  readonly profileComplete: (userId: string) => Promise<boolean>;
  readonly now: () => Date;
}

export type RegistrationResult =
  | { ok: true; status: RegistrationStatus }
  | { ok: false; error: "signin" | "profile" | "invalid" | "captcha" | "closed" };

const Input = z
  .object({ slug: z.string().refine(isValidSlug), token: z.string().max(4000) })
  .strict();

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Internal event registration (flowchart: EVENT DETAIL → Register). Guests must sign in first;
 * the captcha is checked before anything is written; one registration per member and event; the
 * confirmation e-mail goes out once (key event:{id}:registered:{uid}).
 */
export function createEventRegistration(deps: RegistrationDeps) {
  return async (
    user: { uid: string; email: string | null } | null,
    input: unknown,
    language: Language,
  ): Promise<RegistrationResult> => {
    if (!user) return { ok: false, error: "signin" };
    const parsed = Input.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await deps.captcha(parsed.data.token))) return { ok: false, error: "captcha" };
    if (!(await deps.profileComplete(user.uid))) return { ok: false, error: "profile" };
    const event = await deps.findEvent(parsed.data.slug);
    if (!event) return { ok: false, error: "closed" };
    let result: { status: RegistrationStatus; created: boolean };
    try {
      result = await deps.register(event.id, user.uid, deps.now());
    } catch (error) {
      if (error instanceof RuleViolationError) return { ok: false, error: "closed" };
      throw error;
    }
    if (result.created) {
      const t = DICTIONARIES[language].events;
      const line = result.status === "confirmed" ? t.mailConfirmed : t.mailWaitlisted;
      await deps.send(
        {
          channel: "email",
          to: user.email,
          subject: `${t.mailSubject}: ${event.title}`,
          text: `${line}\n\n${event.title}`,
          html: `<p>${escapeHtml(line)}</p><p><strong>${escapeHtml(event.title)}</strong></p>`,
        },
        `event:${event.id}:registered:${user.uid}`,
      );
    }
    return { ok: true, status: result.status };
  };
}
