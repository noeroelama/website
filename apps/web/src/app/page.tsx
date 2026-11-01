import { cookies } from "next/headers";
import { Suspense } from "react";
import { NewsletterField } from "@/components/newsletter-field";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { publicEvents } from "@/server/events";
import { publicNews } from "@/server/news";
import { logger } from "@/server/session";

/** One feature card on the home page (Figma "HOME PUBLIC"): title, short text, link. */
interface FeaturedCard {
  title: string;
  desc: string;
  href: string;
}

/**
 * Latest 3 events as design cards (streams in). "/" must always answer for a guest, so a failing
 * read is logged and the section falls back to placeholder cards from the dictionary.
 */
async function LatestEvents() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const events = await publicEvents().catch((error: unknown) => {
    logger().error("home_latest_events_failed", { error: String(error) });
    return [];
  });
  const cards: FeaturedCard[] = events.slice(0, 3).map((e) => ({
    title: e.title,
    desc: e.description,
    href: `/events/${e.slug}`,
  }));
  if (cards.length === 0) {
    cards.push(...t.home.fallbackEvents.map((f) => ({ ...f, href: "/events" })));
  }
  return (
    <section className="home-section">
      <h2>{t.home.eventsHeading}</h2>
      <ul className="home-cards">
        {cards.map((card) => (
          <li key={card.href + card.title} className="home-card">
            <h3>
              <a href={card.href}>{card.title}</a>
            </h3>
            <p>{card.desc}</p>
            <a className="home-card__action" href={card.href}>
              {t.events.register}
            </a>
          </li>
        ))}
      </ul>
      <a className="home-section__more" href="/events">
        {t.home.allEvents}
      </a>
    </section>
  );
}

/** Latest 3 news as design cards; same fallback behaviour as the events section. */
async function LatestNews() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const news = await publicNews().catch((error: unknown) => {
    logger().error("home_latest_news_failed", { error: String(error) });
    return [];
  });
  const cards: FeaturedCard[] = news.slice(0, 3).map((n) => ({
    title: n.title,
    desc: n.summary,
    href: `/news/${n.slug}`,
  }));
  if (cards.length === 0) {
    cards.push(...t.home.fallbackNews.map((f) => ({ ...f, href: "/news" })));
  }
  return (
    <section className="home-section">
      <h2>{t.home.newsHeading}</h2>
      <ul className="home-cards">
        {cards.map((card) => (
          <li key={card.href + card.title} className="home-card">
            <h3>
              <a href={card.href}>{card.title}</a>
            </h3>
            <p>{card.desc}</p>
            <a className="home-card__action" href={card.href}>
              {t.home.readMore}
            </a>
          </li>
        ))}
      </ul>
      <a className="home-section__more" href="/news">
        {t.home.allNews}
      </a>
    </section>
  );
}

// Prerendered (Indonesian shell; the `lang` cookie version streams in). "/" never redirects:
// Google's OAuth review fetches it as a guest and must find the purpose and the data notice.
export default function HomePage() {
  return (
    <main>
      <Localized
        render={(t) => (
          <>
            <section className="home-hero">
              <h1>{t.home.heroTitle}</h1>
              <p>{t.home.heroSubtitle}</p>
              <a href="/about">{t.home.heroCta}</a>
            </section>
            <section className="home-stats">
              <div className="home-stats__inner">
                <h2>{t.home.statsHeading}</h2>
                <ul className="home-stats__grid">
                  {t.home.stats.map((stat) => (
                    <li key={stat.label} className="home-stat">
                      <strong>{stat.value}</strong>
                      <span>{stat.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </>
        )}
      />
      <Suspense fallback={null}>
        <LatestEvents />
      </Suspense>
      <Suspense fallback={null}>
        <LatestNews />
      </Suspense>
      <Localized
        render={(t) => (
          <section className="home-chair">
            <div className="home-chair__inner">
              <h2>{t.home.chairHeading}</h2>
              <p className="home-chair__quote">“{t.home.chairQuote}”</p>
            </div>
          </section>
        )}
      />
      <Localized
        render={(t) => (
          <section className="home-connect">
            <div className="home-connect__inner">
              <h2>{t.home.connectHeading}</h2>
              <p>{t.home.connectBody}</p>
              <NewsletterField t={t.newsletter} />
            </div>
          </section>
        )}
      />
      <Localized
        render={(t) => (
          <div className="ui-shell">
            <section className="site-notice">
              <h2>{t.home.googleHeading}</h2>
              <p>{t.home.google}</p>
              <a href="/privacy">{t.home.googleMore}</a>
            </section>
          </div>
        )}
      />
    </main>
  );
}
