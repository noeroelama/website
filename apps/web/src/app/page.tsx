import { cookies } from "next/headers";
import { Suspense } from "react";
import { NewsCards } from "@/components/news-cards";
import { NewsletterField } from "@/components/newsletter-field";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { formatEventTime } from "@/lib/event-time";
import { publicEvents } from "@/server/events";
import { publishedPublicForms } from "@/server/forms-wiring";
import { publicHighlights } from "@/server/highlights";
import { publicNews } from "@/server/news";
import { publishedRecruitments } from "@/server/recruitment-wiring";
import { logger } from "@/server/session";

/**
 * Latest 3 news (streams in). "/" must always answer for a guest, so a failing read is logged
 * and the section is left out instead of breaking the page.
 */
async function LatestNews() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const news = await publicNews().catch((error: unknown) => {
    logger().error("home_latest_news_failed", { error: String(error) });
    return [];
  });
  if (news.length === 0) return null;
  return (
    <section>
      <h2>{t.news.latest}</h2>
      <NewsCards items={news.slice(0, 3)} t={t} language={language} />
      <a href="/news">{t.news.all}</a>
    </section>
  );
}

/** L1: open recruitments, public forms and upcoming events (streams in; failures leave it out). */
async function Highlights() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].home;
  const items = await Promise.all([publishedRecruitments(), publishedPublicForms(), publicEvents()])
    .then(([recruitments, forms, events]) =>
      publicHighlights({ recruitments, forms, events }, new Date()),
    )
    .catch((error: unknown) => {
      logger().error("home_highlights_failed", { error: String(error) });
      return [];
    });
  if (items.length === 0) return null;
  return (
    <section>
      <h2>{t.highlights}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            {t.highlightKinds[item.kind]}: <a href={item.href}>{item.title}</a>
            {item.at
              ? ` — ${item.kind === "event" ? t.starts : t.closes} ${formatEventTime(item.at, "UTC", language)}`
              : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Prerendered (Indonesian shell; the `lang` cookie version streams in). "/" never redirects:
// Google's OAuth review fetches it as a guest and must find the purpose and the data notice.
export default function HomePage() {
  return (
    <main className="ui-shell">
      <Localized
        render={(t) => (
          <>
            <h1 className="ui-shell-title">{t.home.title}</h1>
            <p>{t.home.tagline}</p>
            <section>
              <h2>{t.home.purposeHeading}</h2>
              <p>{t.home.purpose}</p>
            </section>
            <section>
              <h2>{t.newsletter.label}</h2>
              <NewsletterField t={t.newsletter} />
            </section>
          </>
        )}
      />
      <Suspense fallback={null}>
        <Highlights />
      </Suspense>
      <Suspense fallback={null}>
        <LatestNews />
      </Suspense>
      <Localized
        render={(t) => (
          <section className="site-notice">
            <h2>{t.home.googleHeading}</h2>
            <p>{t.home.google}</p>
            <a href="/privacy">{t.home.googleMore}</a>
          </section>
        )}
      />
    </main>
  );
}
