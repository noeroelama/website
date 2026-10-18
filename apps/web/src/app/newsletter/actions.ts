"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { newsletter } from "@/server/newsletter-wiring";

// Thin wrappers: every rule lives in src/server/newsletter.ts.
export async function subscribeAction(input: { email: string; token: string }) {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  return newsletter().subscribe(input, language);
}

export async function confirmAction(input: { s: string; t: string }) {
  return newsletter().confirm(input);
}

export async function unsubscribeAction(token: string) {
  return newsletter().unsubscribe(token);
}
