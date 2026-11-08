import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";

export const metadata: Metadata = { title: "Tentang kami · About us" };

const ABOUT_BANNER = "/about/banner.svg";

async function AboutContent() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  return (
    <>
      <div className="site-about__hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- banner asset, sized by CSS */}
        <img className="site-event__banner site-about__banner" src={ABOUT_BANNER} alt="" />
        <h1 className="site-event__title">{t.about.title}</h1>
      </div>

      <div className="site-event__inner">
        <section className="site-about__section">
          <h2 className="site-about__heading">{t.about.profilHeading}</h2>
          {t.about.profilParagraphs.map((paragraph, i) => (
            <p
              className={i === 0 ? "site-about__text site-about__lead" : "site-about__text"}
              key={paragraph.slice(0, 24)}
            >
              {paragraph}
            </p>
          ))}
        </section>

        <section className="site-about__section">
          <h2 className="site-about__heading">{t.about.kolaborasiHeading}</h2>
          {t.about.kolaborasiParagraphs.map((paragraph) => (
            <p className="site-about__text" key={paragraph.slice(0, 24)}>
              {paragraph}
            </p>
          ))}
        </section>

        <div className="site-about__aspirasi">
          <section className="site-about__section">
            <h2 className="site-about__heading">{t.about.visionHeading}</h2>
            <p className="site-about__text">{t.about.visionDefault}</p>
          </section>
          <section className="site-about__section">
            <h2 className="site-about__heading">{t.about.missionHeading}</h2>
            <ul className="site-about__missions">
              {t.about.missionDefault.map((item) => {
                const colon = item.indexOf(":");
                const lead = colon === -1 ? item : item.slice(0, colon);
                const body = colon === -1 ? "" : item.slice(colon);
                return (
                  <li key={item.slice(0, 24)}>
                    <strong>{lead}</strong>
                    {body}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <section className="site-about__section">
          <h2 className="site-about__heading">{t.about.structureHeading}</h2>
          <div className="site-about__structure-frame">
            {/* eslint-disable-next-line @next/next/no-img-element -- organization chart asset, sized by CSS */}
            <img className="site-about__structure-img" src="/organization.png" alt="" />
          </div>
        </section>
      </div>
    </>
  );
}

export default function AboutPage() {
  return (
    <main className="site-event site-album site-about">
      <Suspense fallback={null}>
        <AboutContent />
      </Suspense>
    </main>
  );
}
