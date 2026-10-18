import type { Metadata } from "next";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Tentang kami · About us" };

export default function AboutPage() {
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
          <section>
            <h2>{t.about.councilsHeading}</h2>
            <p>
              <a href="/map">{t.about.councils}</a>
            </p>
          </section>
        </main>
      )}
    />
  );
}
