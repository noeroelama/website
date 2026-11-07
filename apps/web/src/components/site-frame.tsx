import { cacheLife } from "next/cache";
import type { Dictionary } from "@/i18n/dictionaries";
import { LEGAL_VERSION } from "@/i18n/dictionaries";
import { getAppUrls } from "@/server/env";
import { SocialLinks } from "./social-links";
import { SiteNav } from "./site-nav";

/** Organisation address and profiles, shown in the footer in every language. */
const ADDRESS =
  "Perkumpulan Pelajar Indonesia Sedunia Jalan Kirai 07, RT 002/RW 001 Cipete Utara, Kebayoran Baru Kota Administrasi Jakarta Selatan Daerah Khusus Ibukota Jakarta 12150";
const COMMUNITY = ["PPI Tiongkok", "PPI Singapore", "PPI Australia", "PPI India", "PPI Thailand"];

/** The logo (shield and name in one image, apps/web/public/logo.webp) links home. */
function Logo({ t }: { t: Dictionary }) {
  return (
    <a href="/" className="site-logo-link">
      {/* eslint-disable-next-line @next/next/no-img-element -- same static file as the admin logo */}
      <img
        className="site-logo-mark"
        src="/logo.webp"
        alt={t.siteName}
        width={3286}
        height={1024}
      />
    </a>
  );
}

/**
 * Header of every public page: links only, no account chip. Labels are English in every
 * language, per the HOME PUBLIC design ("About Us, Events, Gallery, News, Map").
 */
const HEADER_LINKS = [
  ["/about", "About Us"],
  ["/events", "Events"],
  ["/gallery", "Gallery"],
  ["/news", "News"],
  ["/map", "Map"],
] as const;

export function SiteHeader({ t }: { t: Dictionary }) {
  return (
    <header className="site-header">
      <div className="site-frame__inner site-header__inner">
        <Logo t={t} />
        <SiteNav label={t.nav.label} links={HEADER_LINKS} />
      </div>
    </header>
  );
}

/** Year in the copyright line; cached because the shell may not read the clock directly. */
// eslint-disable-next-line @typescript-eslint/require-await -- "use cache" functions must be async
async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export function SiteFooter({ t }: { t: Dictionary }) {
  // English in every language, like the header and the rest of the footer (user:
  // "Beranda Tentang Kami dll dirubah ke bahasa inggris").
  const explore = [
    ["/", "Home"],
    ["/about", "About Us"],
    ["/events", "Events"],
    ["/gallery", "Gallery"],
    ["/news", "News"],
    ["/map", "Map"],
  ] as const;
  const shopUrl = getAppUrls().SHOP_URL;
  return (
    <footer className="site-footer">
      <div className="site-frame__inner site-footer__main">
        <div className="site-footer__brand">
          <Logo t={t} />
          <p>{t.footer.tagline}</p>
        </div>
        <nav aria-label={t.footer.explore}>
          <h2 className="site-footer__heading">{t.footer.explore}</h2>
          <ul className="site-footer__list">
            {explore.map(([href, text]) => (
              <li key={href}>
                <a href={href}>{text}</a>
              </li>
            ))}
          </ul>
          {/* "Service" as its own heading like Explore, with E-commerce under it (user).
              Always shown, even without SHOP_URL; "#" is a placeholder until then. */}
          <h2 className="site-footer__heading">{t.footer.services}</h2>
          <ul className="site-footer__list">
            <li>
              <a href={shopUrl ?? "#"}>{t.footer.shop}</a>
            </li>
          </ul>
        </nav>
        <nav aria-label={t.footer.community}>
          <h2 className="site-footer__heading">{t.footer.community}</h2>
          <ul className="site-footer__list">
            {COMMUNITY.map((name) => (
              <li key={name}>
                <a href="/map">{name}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h2 className="site-footer__heading">{t.footer.address}</h2>
          <address className="site-footer__address">{ADDRESS}</address>
          <SocialLinks className="site-footer__social" label={t.footer.social} />
        </div>
      </div>
      <div className="site-frame__inner site-footer__bottom">
        <span>
          {t.footer.rights} © <CopyrightYear /> | PPI Dunia Kawasan Asia-Oceania
        </span>
        <nav className="site-footer__legal">
          <a href="/terms">{t.footer.terms}</a>
          <a href="/privacy">{t.footer.privacy}</a>
        </nav>
      </div>
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
