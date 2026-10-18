import { Localized } from "@/i18n/localized";

// Prerendered (Indonesian shell; the `lang` cookie version streams in). "/" never redirects:
// Google's OAuth review fetches it as a guest and must find the purpose and the data notice.
export default function HomePage() {
  return (
    <Localized
      render={(t) => (
        <main className="ui-shell">
          <h1 className="ui-shell-title">{t.home.title}</h1>
          <p>{t.home.tagline}</p>
          <section>
            <h2>{t.home.purposeHeading}</h2>
            <p>{t.home.purpose}</p>
          </section>
          <section className="site-notice">
            <h2>{t.home.googleHeading}</h2>
            <p>{t.home.google}</p>
            <a href="/privacy">{t.home.googleMore}</a>
          </section>
        </main>
      )}
    />
  );
}
