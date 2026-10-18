import type { PublicEvent } from "@website/domain/events";
import type { Dictionary, Language } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";

/** Event cards (/events, Home): banner, type, title, date on the event's clock, location. */
export function EventCards({
  items,
  t,
  language,
}: {
  items: readonly PublicEvent[];
  t: Dictionary;
  language: Language;
}) {
  return (
    <ul className="site-cards">
      {items.map((e) => (
        <li key={e.slug} className="site-card">
          {e.bannerImage && (
            // eslint-disable-next-line @next/next/no-img-element -- Storage serves a 480 px WebP thumbnail
            <img className="site-card__image" src={e.bannerImage.thumbUrl} alt="" loading="lazy" />
          )}
          <p className="site-muted">{t.events.types[e.type]}</p>
          <h3 className="site-card__title">
            <a href={`/events/${e.slug}`}>{e.title}</a>
          </h3>
          <p className="site-muted">
            {formatEventTime(e.startsAt, e.timezone, language)}
            {e.location && ` · ${e.location}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
