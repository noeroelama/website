import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeVerificationCode } from "@website/domain/documents";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";

export const metadata: Metadata = {
  title: "Verifikasi Dokumen",
  robots: { index: false, follow: false },
};
export const instant = false;

/** /verify: type the code printed on a letter (the QR opens /verify/<code> directly). */
export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const [{ code }, jar] = await Promise.all([searchParams, cookies()]);
  const typed = typeof code === "string" ? code : null;
  const normalized = typed ? normalizeVerificationCode(typed) : null;
  if (normalized) redirect(`/verify/${normalized}`);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)].verification;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      <form className="ui-form" method="get" action="/verify">
        <label className="ui-field">
          <span>{t.codeLabel}</span>
          <input
            className="ui-input"
            name="code"
            required
            maxLength={11}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="8F3KM-QRTVW"
            defaultValue={typed ?? ""}
          />
        </label>
        {typed !== null && <p className="site-notice">{t.badCode}</p>}
        <button className="ui-button" type="submit">
          {t.check}
        </button>
      </form>
    </main>
  );
}
