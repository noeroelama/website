import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isRecruitmentOpen } from "@website/domain/recruitment";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { publishedRecruitments } from "@/server/recruitment-wiring";

export const metadata: Metadata = { title: "Recruitment" };

// The language cookie and "open now" are per request.
export const instant = false;

export default async function RecruitmentListPage() {
  // The cookie first: the page is per request, so the cached list is never read at build time.
  const jar = await cookies();
  const recruitments = await publishedRecruitments();
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].recruitment;
  const now = new Date();
  const state = (r: (typeof recruitments)[number]) =>
    isRecruitmentOpen(r, now) ? t.open : r.opensAt > now ? t.upcoming : t.closed;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {recruitments.length === 0 ? (
        <p className="site-muted">{t.empty}</p>
      ) : (
        <ul className="site-cards">
          {recruitments.map((r) => (
            <li key={r.id}>
              <p className="site-muted">{state(r)}</p>
              <h2>
                <a href={`/recruitment/${r.id}`}>{r.title}</a>
              </h2>
              <p className="site-muted">
                {t.window}: {formatEventTime(r.opensAt, "UTC", language)} {t.until}{" "}
                {formatEventTime(r.closesAt, "UTC", language)} (UTC)
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
