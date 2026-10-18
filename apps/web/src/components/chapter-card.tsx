import type { PublicChapter } from "@website/domain/organizations";
import type { Dictionary } from "@/i18n/dictionaries";

/** One member council: logo, name, public contact person and links (map card and list). */
export function ChapterCard({ chapter: c, t }: { chapter: PublicChapter; t: Dictionary["map"] }) {
  const instagram = c.instagram?.startsWith("http")
    ? c.instagram
    : c.instagram && `https://www.instagram.com/${c.instagram.replace(/^@/, "")}`;
  const links = [
    c.website && { label: t.website, href: c.website },
    c.email && { label: t.email, href: `mailto:${c.email}` },
    instagram && { label: t.instagram, href: instagram },
    ...c.socials.map((s) => ({ label: s.label, href: s.url })),
  ].filter((link): link is { label: string; href: string } => Boolean(link));
  return (
    <div className="site-chapter">
      {c.logo && (
        // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
        <img className="site-avatar" src={c.logo.thumbUrl} alt="" loading="lazy" />
      )}
      <h3 className="site-card__title">{c.name}</h3>
      {c.contactName && (
        <p className="site-muted">
          {t.contact}: {c.contactName}
          {c.contactPublic && ` · ${c.contactPublic}`}
        </p>
      )}
      {links.length > 0 && (
        <p className="site-share">
          {links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
