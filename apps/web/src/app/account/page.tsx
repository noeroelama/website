import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInUrl } from "@website/auth";
import { AppShell } from "@website/ui";
import { getSignedInUser } from "@/server/session";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

// No static shell (allowed to block): everything here depends on the session. A visitor without
// a session cookie already got a real 307 to /login from src/proxy.ts; this check verifies it.
export const instant = false;

export default async function AccountPage() {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account")); // → /login?next=%2Faccount, then back here
  return (
    <AppShell title="Your account">
      <p>Signed in as {user.email ?? "your account"}.</p>
      {!user.emailVerified && <p>Please verify your email address — check your inbox.</p>}
      <AccountActions />
    </AppShell>
  );
}
