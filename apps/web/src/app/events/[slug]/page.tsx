import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isRegistrationOpen } from "@website/domain/events";
import { isValidSlug } from "@website/domain/shared";
import { ViewerTime } from "@/components/event-time";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { publicEventBySlug } from "@/server/events";
import { publicAlbumForEvent } from "@/server/gallery";
import { getSignedInUser } from "@/server/session";
import { RegisterButton } from "./register-button";

// Unknown, draft or deleted slug → the 404 page (a soft 404 while streaming; see /news/[slug]).
export const instant = false;

const find = async (slug: string) => (isValidSlug(slug) ? publicEventBySlug(slug) : null);

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const event = await find((await params).slug);
  if (!event) return {};
  const description = event.description.slice(0, 200) || undefined;
  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      images: event.bannerImage ? [event.bannerImage.url] : [],
    },
  };
}

export default async function EventPage({ params }: PageProps<"/events/[slug]">) {
  const event = await find((await params).slug);
  if (!event) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const open = isRegistrationOpen({ ...event, published: true, deletedAt: null }, new Date());
  const [user, album] = await Promise.all([
    open && !event.registrationUrl ? getSignedInUser() : null,
    open ? null : publicAlbumForEvent(event.id),
  ]);
  const time = (date: Date) => (
    <>
      {formatEventTime(date, event.timezone, language)} ({t.events.eventTime})
      <ViewerTime
        iso={date.toISOString()}
        eventZone={event.timezone}
        label={t.events.yourTime}
        language={language}
      />
    </>
  );

  return (
    <main className="ui-shell">
      {event.bannerImage && (
        // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
        <img
          className="ui-article-image"
          src={event.bannerImage.url}
          width={event.bannerImage.width}
          height={event.bannerImage.height}
          alt=""
        />
      )}
      <p className="site-muted">{t.events.types[event.type]}</p>
      <h1 className="ui-shell-title">{event.title}</h1>
      <dl>
        <dt>{t.events.when}</dt>
        <dd>{time(event.startsAt)}</dd>
        {event.location && (
          <>
            <dt>{t.events.where}</dt>
            <dd>{event.location}</dd>
          </>
        )}
        {event.registrationClosesAt && (
          <>
            <dt>{t.events.deadline}</dt>
            <dd>{time(event.registrationClosesAt)}</dd>
          </>
        )}
      </dl>

      {/* Registration decision (flowchart): open → register; closed → the event's album. */}
      <section>
        {!open ? (
          <>
            <p>{t.events.closed}</p>
            {album && (
              <p>
                <a href={`/gallery/${album.slug}`}>{t.gallery.eventAlbum}</a>
              </p>
            )}
          </>
        ) : event.registrationUrl ? (
          <a
            className="ui-button"
            href={event.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.events.register}
          </a>
        ) : user ? (
          <RegisterButton
            slug={event.slug}
            labels={{
              register: t.events.register,
              registering: t.events.registering,
              confirmed: t.events.confirmed,
              waitlisted: t.events.waitlisted,
              closed: t.events.closed,
              captchaFailed: t.events.captchaFailed,
              failed: t.events.failed,
              signInToRegister: t.events.signInToRegister,
            }}
          />
        ) : (
          <a
            className="ui-button"
            href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}
          >
            {t.events.signInToRegister}
          </a>
        )}
      </section>

      <p className="site-pre">{event.description}</p>

      {event.schedule.length > 0 && (
        <section>
          <h2>{t.events.schedule}</h2>
          <ul>
            {event.schedule.map((row, i) => (
              <li key={i}>
                {row.time && <strong>{row.time} </strong>}
                {row.title}
                {row.description && <span className="site-muted"> — {row.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.speakers.length > 0 && (
        <section>
          <h2>{t.events.speakers}</h2>
          <ul className="site-cards">
            {event.speakers.map((s, i) => (
              <li key={i} className="site-card">
                {s.photo && (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
                  <img className="site-avatar" src={s.photo.thumbUrl} alt="" loading="lazy" />
                )}
                <h3 className="site-card__title">{s.name}</h3>
                {s.description && <p className="site-muted">{s.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.sponsors.length > 0 && (
        <section>
          <h2>{t.events.sponsors}</h2>
          <ul className="site-logos">
            {event.sponsors.map((s) => (
              <li key={s.order} title={s.caption}>
                {s.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
                  <img className="site-logo" src={s.logo.thumbUrl} alt={s.caption} loading="lazy" />
                ) : (
                  s.caption
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
