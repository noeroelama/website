import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { EventCards } from "@/components/event-cards";
import { FieldIcon } from "@/components/site-field-icon";
import { SitePager } from "@/components/site-pager";
import { SubmitOnChangeSelect } from "@/components/submit-on-change-select";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import {
  EVENT_CATEGORIES,
  TIME_RANGES,
  eventQuery,
  eventsHref,
  pageOfEvents,
  regionsOf,
} from "@/lib/event-query";
import { publicEvents } from "@/server/events";

export const metadata: Metadata = { title: "Events" };

// Design (Figma "EVENT PUBLIC"): cream page, Poppins title + Inter tagline, dark filter
// bar (date range + region + search), category pills with a count, 3-up cards, numbered
// pager. Static shell (title); the filtered list streams in.
export default function EventsPage({ searchParams }: PageProps<"/events">) {
  return (
    <main className="site-lists site-lists--events">
      <div className="site-lists__inner">
        <Localized
          render={(t) => (
            <>
              <h1 className="site-lists__title">{t.pages.events}</h1>
              <p className="site-lists__tagline">{t.events.tagline}</p>
            </>
          )}
        />
        <Suspense fallback={null}>
          <EventList searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function EventList({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const query = eventQuery(await searchParams);
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const all = await publicEvents();
  const regions = regionsOf(all);
  const { items, count, page, pages } = pageOfEvents(all, query);
  const filtered =
    query.category !== null ||
    query.q !== null ||
    query.region !== null ||
    query.from !== null ||
    query.to !== null;
  return (
    <>
      <form className="site-lists__bar" action="/events" method="get">
        <div className="site-lists__fields">
          <label className="site-lists__field">
            <span className="site-lists__field-label">
              <FieldIcon name="date" className="site-lists__field-label-icon" />
              {t.events.period}
            </span>
            <span className="site-lists__field-controls">
              <span className="site-lists__box">
                <FieldIcon name="date" className="site-lists__box-icon" />
                <SubmitOnChangeSelect className="ui-input" name="time" defaultValue={query.time}>
                  {TIME_RANGES.filter(
                    (range) => range !== "custom",
                  ) /* "Menyesuaikan" removed (user) */
                    .map((range) => (
                      <option key={range} value={range}>
                        {t.events.periodOptions[range]}
                      </option>
                    ))}
                </SubmitOnChangeSelect>
              </span>
              {query.time === "custom" && (
                <>
                  <span className="site-lists__box">
                    <FieldIcon name="date" className="site-lists__box-icon" />
                    <input
                      className="ui-input"
                      type="date"
                      name="from"
                      defaultValue={query.from ?? ""}
                    />
                  </span>
                  <span aria-hidden="true">–</span>
                  <span className="site-lists__box">
                    <FieldIcon name="date" className="site-lists__box-icon" />
                    <input
                      className="ui-input"
                      type="date"
                      name="to"
                      defaultValue={query.to ?? ""}
                    />
                  </span>
                </>
              )}
            </span>
          </label>
          <label className="site-lists__field">
            <span className="site-lists__field-label">
              <FieldIcon name="region" className="site-lists__field-label-icon" />
              {t.events.region}
            </span>
            <span className="site-lists__field-controls">
              <span className="site-lists__box">
                <FieldIcon name="region" className="site-lists__box-icon" />
                <SubmitOnChangeSelect
                  className="ui-input"
                  name="region"
                  defaultValue={query.region ?? ""}
                >
                  <option value="">{t.events.allRegions}</option>
                  {regions.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </SubmitOnChangeSelect>
              </span>
            </span>
          </label>
          <label className="site-lists__field">
            <span className="site-lists__field-label">
              <FieldIcon name="search" className="site-lists__field-label-icon" />
              {t.events.search}
            </span>
            <span className="site-lists__field-controls">
              <span className="site-lists__box">
                <FieldIcon name="search" className="site-lists__box-icon" />
                <input
                  className="ui-input"
                  type="search"
                  name="q"
                  placeholder={t.events.searchPlaceholder}
                  defaultValue={query.q ?? ""}
                />
              </span>
            </span>
          </label>
          <button className="site-lists__bar-submit" type="submit">
            {t.events.search}
          </button>
        </div>
        <hr className="site-lists__bar-divider" />
        <div className="site-lists__pills">
          <span className="site-lists__pills-label">{t.events.category}:</span>
          {EVENT_CATEGORIES.map((category) => {
            const active = (query.category ?? "all") === category;
            const href = active
              ? eventsHref({ ...query, category: null, page: 1 }, 1)
              : eventsHref({ ...query, category, page: 1 }, 1);
            return (
              <a
                className="site-lists__pill"
                aria-current={active ? "true" : undefined}
                href={href}
                key={category}
              >
                {category === "all"
                  ? t.events.allTypes
                  : category === "other"
                    ? t.events.other
                    : t.events.pillTypes[category]}
              </a>
            );
          })}
          <span className="site-lists__count">
            <FieldIcon name="count" className="site-lists__count-icon" />
            {t.events.showing.replace("{n}", String(count))}
          </span>
          {filtered && (
            <a href="/events" className="site-lists__bar-clear">
              {t.events.clear}
            </a>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="site-muted">{t.events.empty}</p>
      ) : (
        <EventCards items={items} t={t} />
      )}
      {pages > 1 && (
        <SitePager
          page={page}
          pages={pages}
          hrefOf={(n) => eventsHref(query, n)}
          label={t.news.pagination}
        />
      )}
    </>
  );
}
