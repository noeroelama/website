import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { verification } from "@/server/verification-wiring";
import { LetterContent } from "./letter-content";

export const metadata: Metadata = {
  title: "Verifikasi Dokumen",
  robots: { index: false, follow: false },
};
export const instant = false;

const ZONE = "Asia/Jakarta";

export default async function VerifyCodePage({
  params,
  searchParams,
}: PageProps<"/verify/[code]">) {
  const [{ code }, query, jar] = await Promise.all([params, searchParams, cookies()]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].verification;
  const locale = language === "en" ? "en-GB" : "id-ID";
  const day = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: typeof value === "string" ? "UTC" : ZONE,
    }).format(typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value);
  const moment = (value: Date) =>
    `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: ZONE }).format(value)} WIB`;
  const view = await verification().view(code, null);

  if (!view) {
    return (
      <main className="ui-shell">
        <h1 className="ui-shell-title">{t.title}</h1>
        <p>
          {t.checkedCode}: <code>{code.toUpperCase().slice(0, 20)}</code>
        </p>
        <p className="site-notice">
          <strong>{t.notFoundTitle}</strong> {t.notFound}
        </p>
        <p>
          <a href="/verify">{t.check}</a>
        </p>
      </main>
    );
  }

  const signers = view.signers.length > 0 && (
    <>
      <h2>{t.signers}</h2>
      <dl className="site-details">
        {view.signers.map((s) => (
          <div key={s.desk} className="site-details__row">
            <dt>{s.desk}</dt>
            <dd>
              {s.name}
              {s.position && <span className="site-muted"> · {s.position}</span>}
              <br />
              <small>
                {t.signedAt} {moment(s.signedAt)}
              </small>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );

  if (view.kind === "certificate") {
    return (
      <main className="ui-shell">
        <h1 className="ui-shell-title">{t.title}</h1>
        <p>
          {t.checkedCode}: <code>{view.code}</code>
        </p>
        <p className="site-notice">
          {view.cancelled ? (
            <>
              <strong>{t.certificateCancelled}</strong> {view.cancelledAt && day(view.cancelledAt)}.
              {view.cancelReason && ` ${t.cancelReason}: ${view.cancelReason}.`}
            </>
          ) : (
            <strong>{t.certificateValid}</strong>
          )}
        </p>
        <h2>{t.certificateDetails}</h2>
        <dl className="site-details">
          <dt>{t.certificateNumber}</dt>
          <dd>
            <code>{view.number}</code>
          </dd>
          <dt>{t.holder}</dt>
          <dd>{view.holderName}</dd>
          {view.note && (
            <>
              <dt>{t.note}</dt>
              <dd>{view.note}</dd>
            </>
          )}
          <dt>{t.activity}</dt>
          <dd>{view.activity}</dd>
          {view.letterDate && (
            <>
              <dt>{t.date}</dt>
              <dd>{day(view.letterDate)}</dd>
            </>
          )}
          <dt>{t.issuedBy}</dt>
          <dd>{view.unitName}</dd>
          {view.periodName && (
            <>
              <dt>{t.period}</dt>
              <dd>{view.periodName}</dd>
            </>
          )}
        </dl>
        <p>{t.certificateCompare}</p>
        {!view.cancelled && (
          <p>
            {t.pickupHint} <a href="/certificates">{t.pickupTitle}</a>.
          </p>
        )}
        {signers}
      </main>
    );
  }

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>
        {t.checkedCode}: <code>{view.code}</code>
      </p>
      <p className="site-notice">
        {view.cancelled ? (
          <>
            <strong>{t.cancelled}</strong> {view.cancelledAt && day(view.cancelledAt)}.
            {view.cancelReason && ` ${t.cancelReason}: ${view.cancelReason}.`}
          </>
        ) : (
          <strong>{t.valid}</strong>
        )}
      </p>
      {query["archive"] === "damaged" && <p className="site-notice">{t.archiveDamaged}</p>}
      <h2>{t.details}</h2>
      <dl className="site-details">
        <dt>{t.number}</dt>
        <dd>
          <code>{view.number}</code>
        </dd>
        <dt>{t.type}</dt>
        <dd>{view.typeName}</dd>
        <dt>{t.subject}</dt>
        <dd>{view.subject}</dd>
        {view.recipientMasked && (
          <>
            <dt>{t.recipient}</dt>
            <dd>{view.recipientMasked}</dd>
          </>
        )}
        {view.letterDate && (
          <>
            <dt>{t.date}</dt>
            <dd>{day(view.letterDate)}</dd>
          </>
        )}
        <dt>{t.issuedBy}</dt>
        <dd>{view.unitName}</dd>
        {view.periodName && (
          <>
            <dt>{t.period}</dt>
            <dd>{view.periodName}</dd>
          </>
        )}
      </dl>
      {signers}
      <LetterContent
        code={view.code}
        content={view.content}
        bodyHtml={view.bodyHtml}
        canDownload={view.canDownload}
        cancelled={view.cancelled}
        hint={view.recipientMasked}
        labels={t}
      />
    </main>
  );
}
