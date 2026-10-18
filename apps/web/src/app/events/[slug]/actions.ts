"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { registerForEvent } from "@/server/events";
import { getSignedInUser } from "@/server/session";

// Thin wrapper: every rule lives in src/server/registrations.ts.
export async function registerForEventAction(input: { slug: string; token: string }) {
  const [user, jar] = await Promise.all([getSignedInUser(), cookies()]);
  return registerForEvent()(
    user && { uid: user.uid, email: user.email },
    input,
    languageFrom(jar.get(LANG_COOKIE)?.value),
  );
}
