import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signInUrl } from "@website/auth";
import { AppShell } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ownSignature } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { SignatureForm } from "./signature-form";

export const metadata: Metadata = { title: "Signature", robots: { index: false } };

export const instant = false;

export default async function SignaturePage() {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account/signature"));
  const [current, jar] = await Promise.all([ownSignature().settings(user), cookies()]);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)].signature;
  return (
    <AppShell title={t.title}>
      <p>{t.intro}</p>
      <SignatureForm t={t} current={current} />
      <p>
        <a href="/account">{t.back}</a>
      </p>
    </AppShell>
  );
}
