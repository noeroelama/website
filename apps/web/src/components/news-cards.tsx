import { formatNewsDate, type PublicNews } from "@website/domain/content";
import type { Dictionary, Language } from "@/i18n/dictionaries";

/** News cards (Home, /news, related articles): thumbnail, title, author, publish date. */
export function NewsCards({
  items,
  t,
  language,
}: {
  items: readonly PublicNews[];
  t: Dictionary;
  language: Language;
}) {
  return (
    <ul className="site-cards">
      {items.map((n) => (
        <li key={n.slug} className="site-card">
          {n.featuredImage && (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a 480 px WebP thumbnail
            <img
              className="site-card__image"
              src={n.featuredImage.thumbUrl}
              alt=""
              loading="lazy"
            />
          )}
          <p className="site-muted">{t.news.categories[n.category]}</p>
          <h3 className="site-card__title">
            <a href={`/news/${n.slug}`}>{n.title}</a>
          </h3>
          <p className="site-muted">
            {t.news.by} {n.author} · {formatNewsDate(n.publishAt, language)}
          </p>
        </li>
      ))}
    </ul>
  );
}
