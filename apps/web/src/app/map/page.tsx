import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ChapterCard } from "@/components/chapter-card";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { activeChapters } from "@/server/chapters";
import { ChapterMap } from "./chapter-map";

export const metadata: Metadata = { title: "Map" };

// Static shell (title); the markers and the list stream in from the same cached chapter list.
export default function MapPage() {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.map}</h1>} />
      <Suspense fallback={null}>
        <Chapters />
      </Suspense>
    </main>
  );
}

async function Chapters() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].map;
  const chapters = await activeChapters();
  if (chapters.length === 0) return <p>{t.empty}</p>;
  return (
    <>
      <p>
        {t.intro} <strong>{chapters.length}</strong> {t.count}.
      </p>
      <ChapterMap
        label={t.label}
        closeLabel={t.close}
        markers={chapters.map((c) => ({
          slug: c.slug,
          name: c.name,
          ...c.position,
          card: <ChapterCard chapter={c} t={t} />,
        }))}
      />
      <ul className="site-cards">
        {chapters.map((c) => (
          <li key={c.slug} className="site-card">
            <ChapterCard chapter={c} t={t} />
          </li>
        ))}
      </ul>
    </>
  );
}
