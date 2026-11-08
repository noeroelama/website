import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { PickupForm } from "./pickup-form";

export const metadata: Metadata = {
  title: "Ambil Sertifikat",
  robots: { index: false, follow: false },
};
export const instant = false;

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
