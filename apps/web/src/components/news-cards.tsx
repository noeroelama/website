import type { PublicNews } from "@website/domain/content";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatEventDate } from "@/lib/event-time";

export function NewsCards({ items, t }: { items: readonly PublicNews[]; t: Dictionary }) {
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
          <p className="site-card__type">{t.news.categories[n.category]}</p>
          <h3 className="site-card__title">
            <a href={`/news/${n.slug}`}>{n.title}</a>
          </h3>
          <p className="site-card__meta">
            {formatEventDate(n.publishAt, "UTC")}
            <span aria-hidden="true">•</span>
            {t.news.categories[n.category]}
          </p>
        </li>
      ))}
    </ul>
  );
}
