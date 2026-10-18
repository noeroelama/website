"use client";

import { useState } from "react";
import type { RegistrationResult } from "@/server/registrations";
import { registerForEventAction } from "./actions";

type Grecaptcha = {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
};

/** Loads reCAPTCHA v3 once and returns a token for `action` ("" when no site key is set). */
async function captchaToken(action: string): Promise<string> {
  const siteKey = process.env["NEXT_PUBLIC_RECAPTCHA_SITE_KEY"];
  if (!siteKey) return "";
  const w = window as Window & { grecaptcha?: Grecaptcha };
  if (!w.grecaptcha) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("captcha_load_failed"));
      document.head.append(script);
    });
  }
  const grecaptcha = w.grecaptcha as Grecaptcha;
  await new Promise<void>((resolve) => grecaptcha.ready(resolve));
  return grecaptcha.execute(siteKey, { action });
}

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
