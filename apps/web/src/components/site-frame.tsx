import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { initials } from "@website/ui";
import type { Dictionary } from "@/i18n/dictionaries";
import { LEGAL_VERSION } from "@/i18n/dictionaries";
import { getAppUrls } from "@/server/env";
import { getSignedInUser } from "@/server/session";
import { LoginChip, SiteAccount } from "./site-account";
import { SocialLinks } from "./social-links";
import { SiteNav } from "./site-nav";

const ADDRESS =
  "Perkumpulan Pelajar Indonesia Sedunia Jalan Kirai 07, RT 002/RW 001 Cipete Utara, Kebayoran Baru Kota Administrasi Jakarta Selatan Daerah Khusus Ibukota Jakarta 12150";
const COMMUNITY = ["PPI Tiongkok", "PPI Singapore", "PPI Australia", "PPI India", "PPI Thailand"];

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

export function SiteHeader({ t }: { t: Dictionary }) {
  const links = [
    ["/about", t.nav.about],
    ["/events", t.nav.events],
    ["/gallery", t.nav.gallery],
    ["/news", t.nav.news],
    ["/map", t.nav.map],
  ] as const;
  return (
    <header className="site-header">
      <div className="site-frame__inner site-header__inner">
        <Logo t={t} />
        <SiteNav label={t.nav.label} links={links} />
        <Suspense fallback={<LoginChip t={t.account} />}>
          <HeaderAccount t={t} />
        </Suspense>
      </div>
    </header>
  );
}

async function HeaderAccount({ t }: { t: Dictionary }) {
  const user = await getSignedInUser();
  if (!user) return <LoginChip t={t.account} />;
  const name = user.name ?? user.email ?? t.account.menu;
  return (
    <SiteAccount
      name={name}
      initials={initials(name)}
      picture={user.picture ?? null}
      t={t.account}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/require-await -- "use cache" functions must be async
async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export function SiteFooter({ t }: { t: Dictionary }) {
  const explore = [
    ["/", t.nav.home],
    ["/about", t.nav.about],
    ["/activities", t.pages.activities],
    ["/events", t.nav.events],
    ["/gallery", t.nav.gallery],
    ["/news", t.nav.news],
    ["/map", t.nav.map],
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
