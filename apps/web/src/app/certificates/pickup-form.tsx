"use client";

import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";
import type { PickupResult } from "@/server/verification";
import { findCertificatesAction } from "./actions";

/** The e-mail field of /certificates and the sheets found for it (exact match only). */
export function PickupForm(props: { labels: Dictionary["verification"]; locale: string }) {
  const t = props.labels;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PickupResult | null>(null);
  const [failed, setFailed] = useState(false);
  const day = (date: string) =>
    new Intl.DateTimeFormat(props.locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${date}T00:00:00Z`),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const captcha = await captchaToken("certificate_pickup");
      setResult(await findCertificatesAction({ email, captcha }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const error = result?.ok === false ? result.error : null;
  return (
    <>
      <form className="ui-form site-form" onSubmit={(e) => void submit(e)} noValidate>
        <label className="ui-field">
          <span>{t.emailLabel}</span>
          <input
            className="ui-input"
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error === "email"}
            aria-describedby={error === "email" ? "pickup-email-error" : undefined}
          />
        </label>
        {error === "email" && (
          <p id="pickup-email-error" className="ui-message">
            {t.badEmail}
          </p>
        )}
        <button className="ui-button" type="submit" disabled={busy}>
          {busy ? t.searching : t.find}
        </button>
        <p className="site-muted">{t.recaptchaNotice}</p>
      </form>
      <div role="status" aria-live="polite">
        {failed && <p className="ui-message">{t.failed}</p>}
        {error === "captcha" && <p className="ui-message">{t.captchaFailed}</p>}
        {result?.ok && result.sheets.length === 0 && <p className="site-notice">{t.none}</p>}
        {result?.ok && result.sheets.length > 0 && (
          <>
            <h2>{t.found}</h2>
            {result.sheets.map((sheet) => (
              <dl key={sheet.number + sheet.href} className="site-details">
                <dt>{t.activity}</dt>
                <dd>{sheet.activity}</dd>
                <dt>{t.holder}</dt>
                <dd>
                  {sheet.holderName}
                  {sheet.note && <span className="site-muted"> · {sheet.note}</span>}
                </dd>
                <dt>{t.certificateNumber}</dt>
                <dd>
                  <code>{sheet.number}</code>
                  {sheet.letterDate && (
                    <span className="site-muted"> · {day(sheet.letterDate)}</span>
                  )}
                </dd>
                <dd>
                  <a className="ui-button" href={sheet.href} download>
                    {t.downloadSheet}
                  </a>
                </dd>
              </dl>
            ))}
            <p className="site-muted">{t.linkExpiry}</p>
          </>
        )}
      </div>
    </>
  );
}
