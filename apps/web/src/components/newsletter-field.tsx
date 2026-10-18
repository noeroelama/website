"use client";

import { useId, useState } from "react";
import { subscribeAction } from "@/app/newsletter/actions";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";

/** Newsletter field (Home and footer): required, pattern-checked e-mail; double opt-in on the server. */
export function NewsletterField({ t }: { t: Dictionary["newsletter"] }) {
  const messageId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async (email: string) => {
    setBusy(true);
    try {
      const result = await subscribeAction({ email, token: await captchaToken("newsletter") });
      setMessage(
        result.ok
          ? { text: t.checkInbox, ok: true }
          : { text: result.error === "captcha" ? t.captchaFailed : t.invalid, ok: false },
      );
    } catch {
      setMessage({ text: t.failed, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="site-filters"
      onSubmit={(e) => {
        e.preventDefault();
        const email = new FormData(e.currentTarget).get("email");
        void submit(typeof email === "string" ? email : "");
      }}
    >
      <label>
        {t.label}{" "}
        <input
          className="ui-input"
          type="email"
          name="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder={t.placeholder}
          aria-describedby={messageId}
          aria-invalid={message && !message.ok ? true : undefined}
        />
      </label>
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
      <p
        id={messageId}
        role="status"
        className="ui-message"
        data-tone={message?.ok ? "info" : undefined}
      >
        {message?.text}
      </p>
    </form>
  );
}
