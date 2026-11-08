import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";

export const metadata: Metadata = { title: "Tentang kami · About us" };

/**
 * The board photo at the top of the page (user: "berikan banner dulu untuk foto
 * kepengurusan"), shown on a dark gradient with no text over it (the title was
 * removed on request). The placeholder (`public/about/banner.svg`) is swapped
 * for the real photo — same file name or this constant.
 */
const ABOUT_BANNER = "/about/banner.svg";

async function AboutContent() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  return (
    <>
      {/* Hero: just the board photo (the page title is screen-reader only —
          user: "Tulisan Tentang Kami dan garis dibawah teks itu dihapus aja"). */}
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

        {/* Visi and Misi on one maroon card — the contrasting block of the page. */}
        <div className="site-about__aspirasi">
          <section className="site-about__section">
            <h2 className="site-about__heading">{t.about.visionHeading}</h2>
            <p className="site-about__text">{t.about.visionDefault}</p>
          </section>
          <section className="site-about__section">
            <h2 className="site-about__heading">{t.about.missionHeading}</h2>
            <ul className="site-about__missions">
              {t.about.missionDefault.map((item) => {
                // The slogan ("A—Accelerate Collaboration" … up to the colon)
                // renders BOLD (user round 12: "teks Accelerate Collaboration,
                // Knit Strategic Partnership, Spark Innovation, Inspire Impact
                // dicetak tebal"); the description keeps the normal weight.
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
          {/* The organisation chart on the same maroon panel card as Visi-Misi (user). */}
          <div className="site-about__structure-frame">
            {/* eslint-disable-next-line @next/next/no-img-element -- organization chart asset, sized by CSS */}
            <img className="site-about__structure-img" src="/organization.png" alt="" />
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * About Us (user): the gallery detail template's frame, redesigned to look
 * elegant — a full-bleed photo hero with a dark gradient (NO title over it
 * anymore: "Tulisan Tentang Kami dan garis dibawah teks itu dihapus aja"; the
 * h1 still exists for screen readers), then the cream page in a narrow
 * centred column with the sections: "Profil PPIDK Asia-Oseania" (the design
 * copy, static dictionary text, with a drop cap on the first paragraph),
 * "Kolaborasi ASIANIA", "VISI" and "MISI" on ONE maroon card (the gold
 * A—K—S—I initials), and "Struktur Organisasi" (the static organisation
 * chart). Headings have a gold ornament rule; the body is justified. Static
 * shell; the language cookie streams in (like /map).
 */
export default function AboutPage() {
  return (
    <main className="site-event site-album site-about">
      <Suspense fallback={null}>
        <AboutContent />
      </Suspense>
    </main>
  );
}
