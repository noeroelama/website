import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasTwoSignInMethods, signInUrl } from "@website/auth";
import { AppShell } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { registrations } from "@/server/events";
import { ownSignInMethods } from "@/server/passkeys";
import { getSignedInUser } from "@/server/session";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

// No static shell (allowed to block): everything here depends on the session. A visitor without
// a session cookie already got a real 307 to /login from src/proxy.ts; this check verifies it.
export const instant = false;

const PROVIDER_LABEL: Record<string, string> = {
  "google.com": "Google",
  password: "E-mail and password",
};

export default async function AccountPage() {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account")); // → /login?next=%2Faccount, then back here
  // Own registrations only (registrations.read_own): the query is keyed by the session's uid.
  const [methods, mine, jar] = await Promise.all([
    ownSignInMethods(user.uid),
    registrations().listByUser(user.uid),
    cookies(),
  ]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].events;
  return (
    <AppShell title="Your account">
      <p>Signed in as {user.email ?? "your account"}.</p>
      {!user.emailVerified && <p>Please verify your email address — check your inbox.</p>}
      <h2>Sign-in methods</h2>
      <ul>
        {methods.providers.map((provider) => (
          <li key={provider}>{PROVIDER_LABEL[provider] ?? provider}</li>
        ))}
        <li>Passkeys: {methods.passkeys}</li>
        <li>Two-step verification: {methods.mfaFactors > 0 ? "on" : "off"}</li>
      </ul>
      <p>
        {hasTwoSignInMethods(methods)
          ? "You have two sign-in methods, as staff roles require."
          : "Staff roles need two sign-in methods: add a passkey below (or turn on two-step verification)."}
      </p>
      <AccountActions />
      <h2>{t.mine}</h2>
      {mine.length === 0 ? (
        <p>{t.mineEmpty}</p>
      ) : (
        <ul>
          {mine.map(({ event, status }) => (
            <li key={event.id}>
              <a href={`/events/${event.slug}`}>{event.title}</a> —{" "}
              {formatEventTime(event.startsAt, event.timezone, language)} · {t.statuses[status]}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
