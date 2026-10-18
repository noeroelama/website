import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnUrl, signInUrl } from "@website/auth";
import { PRIVACY_POLICY_VERSION, type MemberProfile } from "@website/domain/members";
import { AppShell } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { activeChapters } from "@/server/chapters";
import { getAppUrls } from "@/server/env";
import { ownProfile } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";
import { ProfileForm, type ProfileFormValues } from "./profile-form";

export const metadata: Metadata = { title: "Member profile", robots: { index: false } };

// Depends on the session: no static shell. Signed-out visitors already got a 307 from proxy.ts.
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What the form shows: the stored answers (the consent is given again on every save). */
const toFormValues = (p: MemberProfile | null): ProfileFormValues | null =>
  p && {
    fullName: p.fullName,
    gender: p.gender,
    dateOfBirth: p.dateOfBirth,
    ppiCountry: p.ppiCountry,
    university: p.university,
    universityId: p.universityId ?? null,
    educationLevel: p.educationLevel,
    majors: [...p.majors],
    yearOfEntry: p.yearOfEntry,
    estimatedGraduationYear: p.estimatedGraduationYear,
    addressAbroad: p.addressAbroad,
    addressIndonesia: p.addressIndonesia,
    whatsappNumber: p.whatsappNumber,
    emergencyContact: p.emergencyContact,
    timezone: p.timezone,
  };

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", "/account/profile"));
  const [profile, chapters, jar, params] = await Promise.all([
    ownProfile().load(user),
    activeChapters(),
    cookies(),
    searchParams,
  ]);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)].profile;
  // After saving, go back where the gate sent the member from (e.g. the admin app).
  const urls = getAppUrls();
  const allowed = [urls.WEB_URL, urls.ADMIN_URL, urls.SHOP_URL].filter(
    (url): url is string => url !== undefined,
  );
  const next = typeof params["next"] === "string" ? safeReturnUrl(params["next"], allowed) : null;
  return (
    <AppShell title={t.title}>
      <p>{t.intro}</p>
      {!user.emailVerified ? (
        <p role="alert">{t.verifyFirst}</p>
      ) : (
        <ProfileForm
          t={t}
          initial={toFormValues(profile)}
          version={profile?.version ?? null}
          policyVersion={PRIVACY_POLICY_VERSION}
          chapters={chapters.map((c) => ({ countryCode: c.countryCode, name: c.name }))}
          next={next}
        />
      )}
    </AppShell>
  );
}
