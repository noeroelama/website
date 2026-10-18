"use client";

import { useState } from "react";
import type { RegistrationResult } from "@/server/registrations";
import { captchaToken } from "@/lib/captcha-client";
import { registerForEventAction } from "./actions";

/** Internal registration for a signed-in member (the server re-checks everything). */
export function RegisterButton(props: {
  slug: string;
  labels: {
    register: string;
    registering: string;
    confirmed: string;
    waitlisted: string;
    closed: string;
    captchaFailed: string;
    failed: string;
    signInToRegister: string;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const t = props.labels;

  const describe = (result: RegistrationResult): string => {
    if (result.ok) return result.status === "confirmed" ? t.confirmed : t.waitlisted;
    if (result.error === "captcha") return t.captchaFailed;
    if (result.error === "closed") return t.closed;
    if (result.error === "signin") return t.signInToRegister;
    return t.failed;
  };

  const register = async () => {
    setBusy(true);
    try {
      const token = await captchaToken("event_register");
      setMessage(describe(await registerForEventAction({ slug: props.slug, token })));
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-filters">
      <button className="ui-button" type="button" disabled={busy} onClick={() => void register()}>
        {busy ? t.registering : t.register}
      </button>
      {message && (
        <p role="status" className="ui-message" data-tone="info">
          {message}
        </p>
      )}
    </div>
  );
}
