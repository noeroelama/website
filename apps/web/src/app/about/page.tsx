import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { activeChapters } from "@/server/chapters";

/** Member councils: the same list as the map, so the count always matches the markers. */
async function Councils() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const chapters = await activeChapters();
  if (chapters.length === 0) return null;
  return (
    <>
      <p>
        <strong>{chapters.length}</strong> {t.map.count}
      </p>
      <ul>
        {chapters.map((c) => (
          <li key={c.slug}>{c.name}</li>
        ))}
      </ul>
    </>
  );
}

export const metadata: Metadata = { title: "Tentang kami · About us" };

export default function AboutPage() {
  return (
    <>
      <AboutText />
      <section className="ui-shell">
        <Localized render={(t) => <h2>{t.about.councilsHeading}</h2>} />
        <Suspense fallback={null}>
          <Councils />
        </Suspense>
        <Localized
          render={(t) => (
            <p>
              <a href="/map">{t.about.councils}</a>
            </p>
          )}
        />
      </section>
    </>
  );
}

function AboutText() {
  return (
    <Localized
      render={(t) => (
        <main className="ui-shell">
          <h1 className="ui-shell-title">{t.about.title}</h1>
          <p>{t.about.intro}</p>
          <section>
            <h2>{t.about.whatHeading}</h2>
            <ul>
              {t.about.what.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>{t.about.structureHeading}</h2>
            <p>{t.about.structure}</p>
          </section>
        </main>
      )}
    />
  );
}
