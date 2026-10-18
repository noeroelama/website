import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createFirestoreEventReader,
  createFirestoreRegistrationStore,
} from "@website/db/firestore";
import type { PublicEvent } from "@website/domain/events";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { messenger } from "./messaging";
import { hasCompleteProfile } from "./profile-wiring";
import { createEventRegistration } from "./registrations";

const reader = lazyEnv(() => createFirestoreEventReader(webDb()));
export const registrations = lazyEnv(() => createFirestoreRegistrationStore(webDb()));

/** Published events, newest first (cached for minutes under the tag "events"). */
export async function publicEvents(): Promise<PublicEvent[]> {
  "use cache";
  cacheTag("events");
  cacheLife("minutes");
  return reader().listPublished();
}

export async function publicEventBySlug(slug: string): Promise<PublicEvent | null> {
  "use cache";
  cacheTag("events");
  cacheLife("minutes");
  return reader().findPublishedBySlug(slug);
}

/** Register button (src/app/events/[slug]/actions.ts). Reads the event uncached. */
export const registerForEvent = lazyEnv(() => {
  const env = getWebEnv();
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createEventRegistration({
    findEvent: (slug) => reader().findPublishedBySlug(slug),
    register: (eventId, userId, now) => registrations().register(eventId, userId, now),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "event_register",
      ),
    send: (message, key) => messenger().send(message, key),
    profileComplete: hasCompleteProfile,
    now: () => new Date(),
  });
});
