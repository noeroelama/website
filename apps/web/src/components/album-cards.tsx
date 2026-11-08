import type { PublicAlbum } from "@website/domain/gallery";
import type { Dictionary } from "@/i18n/dictionaries";
import { cityOf, formatEventDate } from "@/lib/event-time";

/**
 * Album cards (/gallery): the same card content as the events list — banner, type,
 * title, meta line with dot separators (date · location · type) — fed by the album's
 * event snapshots (user: "Isi card samakan dengan event"). Albums without a snapshot
 * (old imports) render title + photo count only.
 */
export function AlbumCards({ items, t }: { items: readonly PublicAlbum[]; t: Dictionary }) {
  return (
    <ul className="site-cards">
      {items.map((a) => (
        <li key={a.slug} className="site-card">
          {a.cover && (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a 480 px WebP thumbnail
            <img className="site-card__image" src={a.cover.thumbUrl} alt="" loading="lazy" />
          )}
          {a.eventType && (
            <p className="site-muted site-card__type">{t.events.types[a.eventType]}</p>
          )}
          <h3 className="site-card__title">
            <a href={`/gallery/${a.slug}`}>{a.eventTitle}</a>
          </h3>
          {a.eventStartsAt ? (
            <p className="site-card__meta">
              {formatEventDate(a.eventStartsAt, a.eventTimezone ?? "UTC")}
              {a.eventLocation && (
                <>
                  <span aria-hidden="true">•</span>
                  {cityOf(a.eventLocation)}
                </>
              )}
              {a.eventType && (
                <>
                  <span aria-hidden="true">•</span>
                  {t.events.types[a.eventType]}
                </>
              )}
            </p>
          ) : (
            <p className="site-muted">
              {a.photoCount} {t.gallery.photos}
            </p>
          )}
          {a.eventDescription && <p className="site-card__excerpt">{a.eventDescription}</p>}
        </li>
      ))}
    </ul>
  );
}
