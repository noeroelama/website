"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Account actions for the admin account page — same look as the public web
 * account page (websites apps/web/src/app/account/account-actions.tsx):
 * filled primary (ui-button) buttons stacked in a ui-form column.
 *
 * Sign out reuses the admin session route. Passkeys are managed on the public
 * web account page (the admin never holds the browser Firebase SDK), so the
 * "Add a passkey" button links there instead of registering one here. The link
 * is only shown when `url` (the public web account URL) is provided.
 */
export function AccountActions({ url }: { url?: string | undefined }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setSignOutFailed(false);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      router.push("/"); // signed-out visitors are sent to the web sign-in
      router.refresh(); // drop server components rendered with the old session
    } catch {
      setSignOutFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="ui-form">
      {url ? (
        <a className="ui-button" href={url}>
          Add a passkey
        </a>
      ) : null}
      <button className="ui-button" type="button" disabled={busy} onClick={() => void signOut()}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {signOutFailed ? (
        <p role="alert" className="ui-message">
          Could not sign out. Please try again.
        </p>
      ) : null}
    </div>
  );
}
