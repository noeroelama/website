import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { PickupForm } from "./pickup-form";

// Never indexed; the per-IP limit is the tighter verification one (lib/verification-host.ts).
export const metadata: Metadata = {
  title: "Ambil Sertifikat",
  robots: { index: false, follow: false },
};
export const instant = false;

/** /certificates (D5-P): a participant downloads their own certificate sheets by e-mail. */
export default async function CertificatesPage() {
  const jar = await cookies();
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].verification;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.pickupTitle}</h1>
      <p>{t.pickupIntro}</p>
      <PickupForm labels={t} locale={language === "en" ? "en-GB" : "id-ID"} />
    </main>
  );
}
