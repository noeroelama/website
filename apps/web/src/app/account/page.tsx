import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasTwoSignInMethods, signInUrl } from "@website/auth";
import { AppShell } from "@website/ui";
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
  const methods = await ownSignInMethods(user.uid);
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
    </AppShell>
  );
}
