import type { PublicEvent } from "@website/domain/events";
import type { Dictionary } from "@/i18n/dictionaries";
import { cityOf, formatEventDate } from "@/lib/event-time";

/**
 * Event cards (/events): banner, type, title, meta line with dot separators
 * (date · location · type, as the design card), description excerpt.
 */
export function EventCards({ items, t }: { items: readonly PublicEvent[]; t: Dictionary }) {
  return (
    <ul className="site-cards">
      {items.map((e) => (
        <li key={e.slug} className="site-card">
          {e.bannerImage && (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a 480 px WebP thumbnail
            <img className="site-card__image" src={e.bannerImage.thumbUrl} alt="" loading="lazy" />
          )}
          <p className="site-muted site-card__type">{t.events.types[e.type]}</p>
          <h3 className="site-card__title">
            <a href={`/events/${e.slug}`}>{e.title}</a>
          </h3>
          <p className="site-card__meta">
            {formatEventDate(e.startsAt, e.timezone)}
            {e.location && (
              <>
                <span aria-hidden="true">•</span>
                {cityOf(e.location)}
              </>
            )}
            <span aria-hidden="true">•</span>
            {t.events.types[e.type]}
          </p>
          <p className="site-muted site-card__excerpt">{e.description}</p>
        </li>
      ))}
    </ul>
  );
}
