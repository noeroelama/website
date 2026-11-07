import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isRegistrationOpen } from "@website/domain/events";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { cityOf, formatEventDate, formatEventTimeRange } from "@/lib/event-time";
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

  return (
    <main className="site-event">
      {event.bannerImage && (
        // Full-bleed banner: flush with the header and the page edges (design hero, user).
        // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
        <img
          className="site-event__banner"
          src={event.bannerImage.url}
          width={event.bannerImage.width}
          height={event.bannerImage.height}
          alt=""
        />
      )}
      {/* Hero: the header block — title, meta and the Register button as one unit,
          left-aligned and identical on every event (only the content differs, user). */}
      <div className="site-event__inner">
        <header className="site-event__head">
          <h1 className="site-event__title">{event.title}</h1>
          <p className="site-event__meta">
            {formatEventDate(event.startsAt, event.timezone)}
            {event.location && (
              <>
                <span aria-hidden="true">•</span>
                {cityOf(event.location)}
              </>
            )}
            <span aria-hidden="true">•</span>
            {t.events.types[event.type]}
            <span aria-hidden="true">|</span>
            {formatEventTimeRange(event.startsAt, event.endsAt, event.timezone)}
          </p>

          {/* Registration decision (flowchart): open → register; closed → a disabled
              button (same layout everywhere; only the content differs), album if any. */}
          <div className="site-event__actions">
            {!open ? (
              <>
                <button className="site-event__button" type="button" disabled aria-disabled="true">
                  {t.events.register}
                </button>
                <p className="site-muted site-event__closed">
                  {t.events.closed}
                  {album && (
                    <>
                      {" "}
                      · <a href={`/gallery/${album.slug}`}>{t.gallery.eventAlbum}</a>
                    </>
                  )}
                </p>
              </>
            ) : event.registrationUrl ? (
              <a
                className="site-event__button"
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
                  profileNeeded: t.events.profileNeeded,
                  captchaFailed: t.events.captchaFailed,
                  failed: t.events.failed,
                  signInToRegister: t.events.signInToRegister,
                }}
              />
            ) : (
              // Design: a "Register Now" button; guests land on sign-in, keeping where they started.
              <a
                className="site-event__button"
                href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}
              >
                {t.events.register}
              </a>
            )}
          </div>
        </header>

        {/* Design: "About" with the description and schedule; "Guest Speaker" beside it.
            The schedule lives in the About column so its black lines match the About
            boundaries (user). */}
        <div className={event.speakers.length > 0 ? "site-event__columns" : undefined}>
          <section className="site-event__about">
            <h2 className="site-event__heading">{t.events.about}</h2>
            {/* One <p> per paragraph; margins collapsed to 0 so there is no gap (user). */}
            <div className="site-event__text">
              {event.description.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            {event.schedule.length > 0 && (
              <section className="site-event__schedule">
                <h2 className="site-event__heading">{t.events.schedule}</h2>
                {/* Plain rows, no list bullets, no line above the first row (user). */}
                {event.schedule.map((row, i) => (
                  <div className="site-event__schedule-row" key={i}>
                    {row.time && <strong>{row.time}</strong>}
                    {row.title}
                  </div>
                ))}
              </section>
            )}
          </section>
          {event.speakers.length > 0 && (
            <section className="site-event__speakers">
              <h2 className="site-event__heading">{t.events.speakers}</h2>
              <ul>
                {event.speakers.map((s, i) => (
                  <li key={i}>
                    {s.photo && (
                      // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
                      <img className="site-avatar" src={s.photo.thumbUrl} alt="" loading="lazy" />
                    )}
                    <span>
                      <strong>{s.name}</strong>
                      {s.description && <span className="site-muted">{s.description}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Design keeps the heading on every event; logos render only when present. */}
        <section className="site-event__partners">
          <h2 className="site-event__heading">{t.events.sponsors}</h2>
          {event.sponsors.length > 0 && (
            <ul className="site-logos">
              {event.sponsors.map((s) => (
                <li key={s.order} title={s.caption}>
                  {s.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
                    <img
                      className="site-logo"
                      src={s.logo.thumbUrl}
                      alt={s.caption}
                      loading="lazy"
                    />
                  ) : (
                    s.caption
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
