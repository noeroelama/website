import type { Dictionary, Language } from "@/i18n/dictionaries";
import { LEGAL_VERSION } from "@/i18n/dictionaries";
import { LanguageSwitch } from "./language-switch";

/** Header navigation of every public page (no personal data: it is in the prerendered shell). */
export function SiteHeader({ t, language }: { t: Dictionary; language: Language }) {
  const links = [
    ["/", t.nav.home],
    ["/news", t.nav.news],
    ["/events", t.nav.events],
    ["/gallery", t.nav.gallery],
    ["/map", t.nav.map],
    ["/about", t.nav.about],
  ] as const;
  return (
    <header className="site-header">
      <a href="/" className="site-header__brand">
        {t.siteName}
      </a>
      <nav aria-label={t.nav.label}>
        <ul className="site-header__nav">
          {links.map(([href, text]) => (
            <li key={href}>
              <a href={href}>{text}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="site-header__tools">
        <LanguageSwitch
          current={language}
          label={t.language.label}
          switchTo={t.language.switchTo}
          names={{ id: t.language.id, en: t.language.en }}
        />
        <a href="/login" className="site-header__signin">
          {t.nav.signIn}
        </a>
      </div>
    </header>
  );
}

export function SiteFooter({ t }: { t: Dictionary }) {
  return (
    <footer className="site-footer">
      <span>{t.footer.rights}</span>
      <nav className="site-footer__links">
        <a href="/terms">{t.footer.terms}</a>
        <a href="/privacy">{t.footer.privacy}</a>
      </nav>
    </footer>
  );
}

/** Body of the Terms and Privacy pages. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: readonly { heading: string; paragraphs: readonly string[] }[];
}) {
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{title}</h1>
      <p className="site-muted">
        {updated}: <time dateTime={LEGAL_VERSION}>{LEGAL_VERSION}</time>
      </p>
      <p>{intro}</p>
      {sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
