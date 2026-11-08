import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { CHAPTER_MAP, countryName } from "@/lib/country-names";
import { activeChapters } from "@/server/chapters";
import { SOCIAL_LINKS } from "@/components/social-links";

export const instant = false;

const find = async (slug: string) => {
  if (!isValidSlug(slug)) return null;
  return (await activeChapters()).find((c) => c.slug === slug) ?? null;
};

export async function generateMetadata({ params }: PageProps<"/map/[slug]">): Promise<Metadata> {
  const chapter = await find((await params).slug);
  if (!chapter) return {};
  return {
    title: countryName(
      chapter.countryCode,
      languageFrom((await cookies()).get(LANG_COOKIE)?.value),
    ),
    description: chapter.description || undefined,
  };
}

export default async function ChapterPage({ params }: PageProps<"/map/[slug]">) {
  const chapter = await find((await params).slug);
  if (!chapter) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].map;
  const title = countryName(chapter.countryCode, language);
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
            <div className="chapter__org">{chapter.name}</div>
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
