import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInUrl } from "@website/auth";
import { nextAction } from "@website/domain/recruitment";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { hasCompleteProfile } from "@/server/profile-wiring";
import { recruitmentStore } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Application", robots: { index: false } };

// Per user: needs the session, a complete profile and an application that can still change.
export const instant = false;

export default async function ApplyPage({ params }: PageProps<"/recruitment/[id]/apply">) {
  const { id } = await params;
  const path = `/recruitment/${id}`;
  const user = await getSignedInUser();
  if (!user) redirect(signInUrl("", `${path}/apply`));
  const [r, complete, jar] = await Promise.all([
    recruitmentStore().getPublished(id),
    hasCompleteProfile(user.uid),
    cookies(),
  ]);
  if (!r) notFound();
  if (!complete) redirect(`/account/profile?next=${encodeURIComponent(`${path}/apply`)}`);
  const [application, questions] = await Promise.all([
    recruitmentStore().ownApplication(r.id, user.uid),
    recruitmentStore().questions(r),
  ]);
  const action = nextAction(r, application, new Date());
  if (action !== "start" && action !== "complete" && action !== "revise") redirect(path);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)];

  return (
    <main className="ui-shell">
      <p>
        <a href={path}>← {t.recruitment.back}</a>
      </p>
      <h1 className="ui-shell-title">
        {t.recruitment.apply}: {r.title}
      </h1>
      <ApplyForm
        recruitmentId={r.id}
        maxChoices={r.maxChoices}
        units={r.units.map((u) => ({
          id: u.orgUnitId,
          name: u.name,
          portfolioRequired: u.portfolioRequired,
        }))}
        questions={questions}
        initial={{
          choices: [...(application?.choices ?? [])],
          answers: { ...(application?.answers ?? {}) },
          portfolio: application?.portfolio?.name ?? null,
        }}
        labels={t.recruitment}
        formLabels={t.forms}
      />
    </main>
  );
}
