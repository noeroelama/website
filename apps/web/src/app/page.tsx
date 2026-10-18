import { cookies } from "next/headers";
import { Suspense } from "react";
import { NewsCards } from "@/components/news-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { publicNews } from "@/server/news";
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
          </>
        )}
      />
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
