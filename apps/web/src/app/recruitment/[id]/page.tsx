import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { signInUrl } from "@website/auth";
import { canBook, nextAction } from "@website/domain/recruitment";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { hasCompleteProfile, ownTimezone } from "@/server/profile-wiring";
import { recruitmentStore } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";
import { InterviewTimes } from "./interview-times";
import { OfferButtons } from "./offer-buttons";
import { PactUpload } from "./pact-upload";
import { WithdrawButton } from "./withdraw-button";

// Per request: the applicant's own application and the window.
export const instant = false;

export async function generateMetadata({
  params,
}: PageProps<"/recruitment/[id]">): Promise<Metadata> {
  // Params first: the store (and its env) is only touched at request time, never at build.
  const { id } = await params;
  const r = await recruitmentStore().getVisible(id);
  return r ? { title: r.title } : {};
}

/** A recruitment and, for a signed-in member, their application with ONE next action. */
export default async function RecruitmentPage({ params }: PageProps<"/recruitment/[id]">) {
  const { id } = await params;
  const [r, user, jar] = await Promise.all([
    recruitmentStore().getVisible(id),
    getSignedInUser(),
    cookies(),
  ]);
  if (!r) notFound();
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].recruitment;
  const [application, complete, revisions] = user
    ? await Promise.all([
        recruitmentStore().ownApplication(r.id, user.uid),
        hasCompleteProfile(user.uid),
        recruitmentStore().ownRevisions(r.id, user.uid),
      ])
    : [null, false, []];
  // An unpublished recruitment is shown only to applicants who are already in it.
  if (!r.published && !application) notFound();
  const now = new Date();
  const action = nextAction(r, application, now);
  const [slots, zone] =
    user && action === "interview"
      ? await Promise.all([recruitmentStore().slots(r.id), ownTimezone(user.uid)])
      : [[], "UTC"];
  const path = `/recruitment/${r.id}`;
  const canApply = action === "start" || action === "complete" || action === "revise";

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{r.title}</h1>
      {r.description && <p className="site-pre">{r.description}</p>}
      <p className="site-muted">
        {t.window}: {formatEventTime(r.opensAt, "UTC", language)} {t.until}{" "}
        {formatEventTime(r.closesAt, "UTC", language)} (UTC)
      </p>
      <h2>{t.units}</h2>
      <ul>
        {r.units.map((u) => (
          <li key={u.orgUnitId}>
            {u.name} — {u.quota} {t.seats}
            {u.portfolioRequired ? ` · ${t.portfolio}` : ""}
          </li>
        ))}
      </ul>
      <h2>{t.yourApplication}</h2>
      {!user ? (
        <p>
          <a className="ui-button" href={signInUrl("", path)}>
            {t.signIn}
          </a>
        </p>
      ) : !complete ? (
        <p>
          <a href={`/account/profile?next=${encodeURIComponent(path)}`}>{t.profile}</a>
        </p>
      ) : (
        <div className="ui-form">
          {application && (
            <p>
              {t.statusLabel}: <strong>{t.statuses[application.status]}</strong>
            </p>
          )}
          {action === "revise" && revisions.at(-1) && (
            <p className="site-notice">
              {t.revisionNote}: {revisions.at(-1)?.request}
            </p>
          )}
          {action === "respond_offer" && application?.offer && (
            <>
              <p>
                {t.offerUnit}:{" "}
                <strong>
                  {r.units.find((u) => u.orgUnitId === application.offer?.orgUnitId)?.name}
                </strong>
                <br />
                {t.offerUntil} {formatEventTime(application.offer.expiresAt, "UTC", language)} (UTC)
              </p>
              <OfferButtons recruitmentId={r.id} labels={t} />
            </>
          )}
          {action === "interview" && application && (
            <InterviewTimes
              recruitmentId={r.id}
              zone={zone}
              language={language}
              current={application.interview?.startsAt.toISOString() ?? null}
              times={slots
                .filter((s) => canBook(s, now) && s.id !== application.interview?.slotId)
                .map((s) => ({
                  id: s.id,
                  startsAt: s.startsAt.toISOString(),
                  minutes: s.durationMinutes,
                }))}
              location={slots.find((s) => s.id === application.interview?.slotId)?.location ?? ""}
              labels={t}
            />
          )}
          {action === "upload_pact" && (
            <>
              {application?.pactNote && (
                <p className="site-notice">
                  {t.pactSentBack}: {application.pactNote}
                </p>
              )}
              {r.pactTemplateUrl && (
                <p>
                  <a href={r.pactTemplateUrl} rel="noopener noreferrer" target="_blank">
                    {t.pactTemplate}
                  </a>
                </p>
              )}
              <PactUpload recruitmentId={r.id} labels={t} />
            </>
          )}
          {/* ONE next action (C3): a button when the applicant can act, else what happens next. */}
          {canApply ? (
            <a className="ui-button" href={`${path}/apply`}>
              {t.actions[action]}
            </a>
          ) : (
            <p role="status">{t.actions[action]}</p>
          )}
          {application &&
            ["draft", "submitted", "revision", "interview"].includes(application.status) && (
              <WithdrawButton recruitmentId={r.id} labels={t} />
            )}
        </div>
      )}
    </main>
  );
}
