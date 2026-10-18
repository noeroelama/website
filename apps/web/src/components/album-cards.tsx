import type { PublicAlbum } from "@website/domain/gallery";
import type { Dictionary } from "@/i18n/dictionaries";

/** Album cards (/gallery): cover = first featured image, event title, photo count. */
export function AlbumCards({ items, t }: { items: readonly PublicAlbum[]; t: Dictionary }) {
  return (
    <ul className="site-cards">
      {items.map((a) => (
        <li key={a.slug} className="site-card">
          {a.cover && (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a 480 px WebP thumbnail
            <img className="site-card__image" src={a.cover.thumbUrl} alt="" loading="lazy" />
          )}
          <h3 className="site-card__title">
            <a href={`/gallery/${a.slug}`}>{a.eventTitle}</a>
          </h3>
          <p className="site-muted">
            {a.photoCount} {t.gallery.photos}
          </p>
        </li>
      ))}
    </ul>
  );
}
