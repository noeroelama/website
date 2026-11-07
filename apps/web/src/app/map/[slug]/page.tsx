import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { CHAPTER_MAP, countryName } from "@/lib/country-names";
import { activeChapters } from "@/server/chapters";
import { SOCIAL_LINKS } from "@/components/social-links";

// Unknown or deactivated chapter → the 404 page. With Cache Components the response has
// already started streaming, so the status stays 200 and Next adds `noindex` (a soft 404;
// the same as the news article page).
export const instant = false;

const find = async (slug: string) => {
  if (!isValidSlug(slug)) return null;
  return (await activeChapters()).find((c) => c.slug === slug) ?? null;
};

export async function generateMetadata({ params }: PageProps<"/map/[slug]">): Promise<Metadata> {
  const chapter = await find((await params).slug);
  if (!chapter) return {};
  return {
    title: countryName(chapter.countryCode),
    description: chapter.description || undefined,
  };
}

/**
 * Chapter detail page (user): same black frame as /map, the SAME title and
 * tagline on top (user: "Tambahkan teks Map PPI Negara Kawasan Asia Oseania …
 * Seperti halaman map"), then the country's DESIGN MAP left — New Zealand's
 * for EVERY chapter for now (user: "Sementara untuk map nya gunakan map new
 * Zealand saja") — and the cream
 * panel RIGHT with the chapter's own data — same columns and gap as the /map
 * block (52rem + space-8), not rounded, as tall as its content. The "← Back to
 * Map" link is the panel's first row, above the country name, with air under
 * it (user). The rows are the DASHBOARD's flat rows (user: no field headers):
 * the chapter photo — the chapter's own photo from the DATABASE (the admin
 * form's logo upload; user: "masuk ke database aja … semua foto dan deskripsi
 * untuk 17 negara ada di dashboard"), sized to the description's width
 * (user) — the description,
 * the contact person with their role (BOLD, user: "dicetak tebal"), "Email:" /
 * "Phone:" lines. The contact lines are ONE tight block (no air between them,
 * user: "Jarak antar baris dikurangi") with larger air ABOVE it and ABOVE the
 * chapter name (user: "Jarak antara Budi Setiawan dan atasnya ditambah, serta
 * PPI Selandia Baru dan atasnya ditambah"); the chapter name sits below the
 * phone as PLAIN TEXT — the website link is gone (user: "Link PPI Selandia
 * Baru dihilangkan"). Then the five black platform logos (SOCIAL_LINKS:
 * LinkedIn, YouTube, Instagram, X, Facebook — user: "Logo Social media sama
 * seperti halaman dashboard… Warnanya hitam"), shown on EVERY chapter even
 * with no social fields (the chapter's own platform mix is no longer the
 * row), each to the chapter's own
 * profile for that platform when it has one (the `instagram` field / a
 * matching `socials` row), else the network home page like the footer; links
 * outside the five platforms are not shown. FONTS: name + description POPPINS,
 * everything else Inter (user); all SMALLER still (user: "Ukuran font
 * diperkecil" again) — 16 px name (--text-base, BOLD 700 — user asked to
 * thicken it, then: "Text New Zealand perbesar sedikit saja"), 10 px rows
 * (--text-3xs), all with TIGHT line
 * spacing --leading-3xs (user compared the description's lines with the role
 * line's — both got the same tighter spacing). All of
 * it is the chapter's own data from the admin form, nothing hardcoded; empty
 * fields are left out.
 */
export default async function ChapterPage({ params }: PageProps<"/map/[slug]">) {
  const chapter = await find((await params).slug);
  if (!chapter) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].map;
  const title = countryName(chapter.countryCode);
  // The left column is the chapter's design MAP — only New Zealand's exists, so every
  // chapter uses it for now (user: "Sementara untuk map nya gunakan map new Zealand
  // saja"). The panel photo is the chapter's OWN photo from the database, the admin
  // form's logo upload — every country's photo is a chapter field, no assets picked by
  // file name (user: "masuk ke database aja … semua foto dan deskripsi untuk 17 negara
  // ada di dashboard").
  const photo = chapter.logo?.url ?? null;
  const socials = [
    ...(chapter.instagram
      ? [
          {
            label: t.detail.instagram,
            url: `https://instagram.com/${chapter.instagram.replace(/^@/, "")}`,
          },
        ]
      : []),
    ...chapter.socials,
  ];
  // The five platform logos shared with the footer and the PPi slider: LinkedIn,
  // YouTube, Instagram, X, Facebook — shown on every chapter, BLACK on the cream
  // panel (user: "Logo Social media sama seperti halaman dashboard: LinkedIn,
  // Youtube, Instagram, X, Facebook. Warnanya hitam."). Each logo links to the
  // chapter's OWN profile for that platform when it has one (the `instagram`
  // field or a matching `socials` row); otherwise to the network home page, like
  // the footer row. Links outside the five platforms are not shown here.
  const chapterSocial = new Map(socials.map((social) => [social.label.toLowerCase(), social.url]));
  const socialHref = (name: string, fallback: string) =>
    chapterSocial.get(name.toLowerCase()) ?? fallback;
  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <h1 className="site-lists__title">{t.title}</h1>
        <p className="site-lists__tagline">{t.tagline}</p>
        <div className="chapter">
          {/* eslint-disable-next-line @next/next/no-img-element -- the shared NZ design map, sized by CSS */}
          <img className="chapter__image" src={CHAPTER_MAP} alt="" />
          <section className="chapter__panel">
            <a className="chapter__back" href="/map">
              ← {t.detail.back}
            </a>
            <h2 className="chapter__name">{title}</h2>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- Storage serves the logo; dims come from the DB row
              <img
                className="chapter__logo"
                src={photo}
                width={chapter.logo?.width}
                height={chapter.logo?.height}
                alt=""
              />
            )}
            {chapter.description && <p className="chapter__about">{chapter.description}</p>}
            {Boolean(chapter.contactName || chapter.role || chapter.email || chapter.phone) && (
              <div className="chapter__team">
                {chapter.contactName && <p className="chapter__person">{chapter.contactName}</p>}
                {chapter.role && (
                  <p className="chapter__role">
                    {chapter.role} {chapter.name}
                  </p>
                )}
                {chapter.email && (
                  <p className="chapter__line">
                    {t.detail.email}:{" "}
                    <a className="chapter__link" href={`mailto:${chapter.email}`}>
                      {chapter.email}
                    </a>
                  </p>
                )}
                {chapter.phone && (
                  <p className="chapter__line">
                    {t.detail.phone}:{" "}
                    <a className="chapter__link" href={`tel:${chapter.phone}`}>
                      {chapter.phone}
                    </a>
                  </p>
                )}
              </div>
            )}
            {/* Plain text — the website link is gone (user: "Link PPI Selandia
                Baru dihilangkan"); the `website` field still exists in the admin
                form, it is just not linked here. */}
            <div className="chapter__org">{chapter.name}</div>
            {/* Every chapter shows ALL FIVE logos regardless of its social fields
                (user: the row is always the five dashboard logos); each links to the
                chapter's own profile for that platform when it has one, else the
                network home page. `socials` also feeds the per-platform hrefs. */}
            <ul className="chapter__socials">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.name}>
                  <a
                    href={socialHref(social.name, social.href)}
                    aria-label={social.name}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d={social.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
