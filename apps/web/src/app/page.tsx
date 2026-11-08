import { cookies } from "next/headers";
import { Suspense } from "react";
import { Highlights } from "@/components/highlights";
import { PpiSlider } from "@/components/ppi-slider";
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
 * Sponsor logos in the dark band — each brand appears twice in sequence (Figma frame 2400).
 * eBay and amazon are the PNG logos the client uploaded; AJIO stays a plain text wordmark
 * (regular weight), as the design itself sets it as text in frame 2400.
 */
const HOME_LOGOS: ReadonlyArray<{ src?: string; alt: string }> = [
  { src: "/home/ebay.png", alt: "eBay" },
  { src: "/home/amazon.png", alt: "amazon" },
  { alt: "AJIO" },
  { src: "/home/ebay.png", alt: "eBay" },
  { src: "/home/amazon.png", alt: "amazon" },
  { alt: "AJIO" },
];

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
              {t.home.register}
            </a>
          </li>
        ))}
      </ul>
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
          <section className="home-hero">
            <h1>{t.home.heroTitle}</h1>
            <p>{t.home.heroSubtitle}</p>
            <a href="/about">{t.home.heroCta}</a>
          </section>
        )}
      />
      <Localized
        render={(t) => (
          <section className="home-welcome">
            <div className="home-welcome__inner">
              <div className="home-welcome__photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- anonymous placeholder until the real photo exists */}
                <img src="/home/welcome.svg" alt="" aria-hidden="true" width={600} height={800} />
              </div>
              <div className="home-welcome__text">
                <h2>{t.home.welcomeHeading}</h2>
                <div className="home-welcome__quote">
                  {t.home.welcomeQuote.split("\n\n").map((paragraph) => (
                    <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                  ))}
                </div>
                {/* Only the name, no role line below (user). */}
                <p className="home-welcome__name">{t.home.welcomeName}</p>
              </div>
            </div>
          </section>
        )}
      />
      <Suspense fallback={null}>
        <Highlights />
      </Suspense>
      <Suspense fallback={null}>
        <LatestNews />
      </Suspense>
      <Suspense fallback={null}>
        <LatestEvents />
      </Suspense>
      {/* Empty page the size of the Secretary General's welcome (user: blank, no content). */}
      <section className="home-blank" aria-hidden="true" />
      <Localized
        render={(t) => (
          // Dark band (Figma frame 2400): each sponsor wordmark loaded twice, in sequence,
          // so six logos in total. No logo assets yet — the marks are styled text.
          <section className="home-logos" aria-label={t.home.sponsorLabel}>
            <ol className="home-logos__list">
              {HOME_LOGOS.map((logo, index) => (
                <li key={`${logo.alt}-${index}`} className="home-logos__item">
                  {logo.src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static brand logo PNGs
                    <img
                      className={`home-logos__mark home-logos__mark--${logo.alt.toLowerCase()}`}
                      src={logo.src}
                      alt={logo.alt}
                    />
                  ) : (
                    <span className="home-logos__mark home-logos__mark--text">{logo.alt}</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      />
      <Localized render={(t) => <PpiSlider t={t.home.slider} />} />
    </main>
  );
}
