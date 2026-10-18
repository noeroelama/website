import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { EVENT_TYPES } from "@website/domain/events";
import { EventCards } from "@/components/event-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { eventQuery, eventsHref, pageOfEvents } from "@/lib/event-query";
import { publicEvents } from "@/server/events";

export const metadata: Metadata = { title: "Events" };

// Static shell (title); the filtered list streams in (query string + cached events).
export default function EventsPage({ searchParams }: PageProps<"/events">) {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.events}</h1>} />
      <Suspense fallback={null}>
        <EventList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EventList({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const query = eventQuery(await searchParams);
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const { items, page, pages } = pageOfEvents(await publicEvents(), query);
  return (
    <>
      <form className="site-filters" action="/events">
        <label>
          {t.events.type}{" "}
          <select className="ui-input" name="type" defaultValue={query.type ?? ""}>
            <option value="">{t.events.allTypes}</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.events.types[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.events.from}{" "}
          <input className="ui-input" type="date" name="from" defaultValue={query.from ?? ""} />
        </label>
        <label>
          {t.events.to}{" "}
          <input className="ui-input" type="date" name="to" defaultValue={query.to ?? ""} />
        </label>
        <button className="ui-button" type="submit">
          {t.events.filter}
        </button>
        {(query.type || query.from || query.to) && <a href="/events">{t.events.clear}</a>}
      </form>
      {items.length === 0 ? (
        <p>{t.events.empty}</p>
      ) : (
        <EventCards items={items} t={t} language={language} />
      )}
      {pages > 1 && (
        <nav className="site-pager">
          {page > 1 && <a href={eventsHref(query, page - 1)}>{t.news.previous}</a>}
          <span>
            {page} / {pages}
          </span>
          {page < pages && <a href={eventsHref(query, page + 1)}>{t.news.next}</a>}
        </nav>
      )}
    </>
  );
}
