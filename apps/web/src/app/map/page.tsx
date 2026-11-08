import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { PublicChapter } from "@website/domain/organizations";
import { DICTIONARIES, LANG_COOKIE, languageFrom, type Language } from "@/i18n/dictionaries";
import { REGION_ORDER, chapterAlias, countryName } from "@/lib/country-names";
import { activeChapters } from "@/server/chapters";

export const metadata: Metadata = { title: "Map" };

// Design (user): the map page borrows the news frame — black page, 74rem column,
// cream title and tagline — then a two-column block: the region map image on the
// left, and on the right the side.svg country table recreated from the chapters
// data (user): the region groups of the design (OCEANIA … Others), one cream row
// per chapter, numbered with the design's registry number and the alias (PERMITHA,
// PERPIKA) on the same row. Only active chapters show; the group of each chapter
// comes from its own region field, so moving a chapter to another group (or hiding
// it) is a data change, not a code change.
// Static shell (title); the language cookie and the list stream in.
export default function MapPage() {
  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <Suspense fallback={null}>
          <LocalizedMapPage />
        </Suspense>
      </div>
    </main>
  );
}

/** The chapter's badge number (its own mapNo), or "last", for sorting the rows of a group. */
const rank = (c: PublicChapter): number => c.mapNo ?? Number.MAX_SAFE_INTEGER;

function MapRow({ chapter, language }: { chapter: PublicChapter; language: Language }) {
  const no = chapter.mapNo;
  const alias = chapterAlias(chapter.name);
  return (
    <li className="site-map__item">
      {/* The whole row links to the chapter's detail page (user); the row is the <a>. */}
      <Link className="site-map__row" href={`/map/${chapter.slug}`}>
        {no !== null && <span className="site-map__no">{no}</span>}
        <span className="site-map__label">{countryName(chapter.countryCode, language)}</span>
        {alias && <span className="site-map__alias">{alias}</span>}
      </Link>
    </li>
  );
}

async function LocalizedMapPage() {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].map;
  const chapters = await activeChapters();
  const shown = chapters.filter((c) => c.region !== null);
  const groups = REGION_ORDER.map((region) => ({
    region,
    rows: shown
      .filter((c) => c.region === region)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
  })).filter((group) => group.rows.length > 0);
  return (
    <>
      <h1 className="site-lists__title">{t.title}</h1>
      <p className="site-lists__tagline">{t.tagline}</p>
      <div className="site-map">
        <div className="site-map__map">
          {/* eslint-disable-next-line @next/next/no-img-element -- design asset, sized by CSS */}
          <img className="site-map__image" src="/map/asia-oseania-design.png" alt="" />
        </div>
        <aside>
          {shown.length > 0 ? (
            <div className="site-map__groups">
              {groups.map(({ region, rows }) => (
                <section className="site-map__group" key={region}>
                  <h3 className="site-map__group-title">{t.regions[region]}</h3>
                  <ul className="site-map__list">
                    {rows.map((chapter) => (
                      <MapRow key={chapter.slug} chapter={chapter} language={language} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="site-muted">{t.empty}</p>
          )}
        </aside>
      </div>
    </>
  );
}
