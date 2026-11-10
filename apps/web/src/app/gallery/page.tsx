import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { AlbumCards } from "@/components/album-cards";
import { FieldIcon } from "@/components/site-field-icon";
import { SitePager } from "@/components/site-pager";
import { SubmitOnChangeSelect } from "@/components/submit-on-change-select";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import {
  EVENT_CATEGORIES,
  TIME_RANGES,
  albumQuery,
  albumRegionsOf,
  albumsHref,
  pageOfAlbums,
} from "@/lib/event-query";
import { publicAlbums } from "@/server/gallery";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage({ searchParams }: PageProps<"/gallery">) {
  return (
    <main className="site-lists site-lists--gallery">
      <div className="site-lists__inner">
        <Localized
          render={(t) => (
            <>
              <h1 className="site-lists__title">{t.pages.gallery}</h1>
              <p className="site-lists__tagline">{t.gallery.tagline}</p>
            </>
          )}
        />
        <Suspense fallback={null}>
          <AlbumList searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function AlbumList({ searchParams }: Pick<PageProps<"/gallery">, "searchParams">) {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const query = albumQuery(await searchParams);
  const albums = await publicAlbums();
  const { items, count, page, pages } = pageOfAlbums(albums, query);
  const filtered =
    query.category !== null || query.q !== null || query.region !== null || query.time !== null;
  return (
    <>
      <form className="site-lists__bar" action="/gallery" method="get">
        <div className="site-lists__fields">
          <label className="site-lists__field">
            <span className="site-lists__field-label">
              <FieldIcon name="date" className="site-lists__field-label-icon" />
              {t.events.period}
            </span>
            <span className="site-lists__field-controls">
              <span className="site-lists__box">
                <FieldIcon name="date" className="site-lists__box-icon" />
                <SubmitOnChangeSelect
                  className="ui-input"
                  name="time"
                  defaultValue={query.time ?? ""}
                >
                  <option value="">{t.events.allPeriods}</option>
                  {TIME_RANGES.filter((range) => range !== "custom").map((range) => (
                    <option key={range} value={range}>
                      {t.events.periodOptions[range]}
                    </option>
                  ))}
                </SubmitOnChangeSelect>
              </span>
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
                  {albumRegionsOf(albums).map((region) => (
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
            return (
              <a
                className="site-lists__pill"
                aria-current={active ? "true" : undefined}
                href={albumsHref({ ...query, category: active ? null : category })}
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
            <a href="/gallery" className="site-lists__bar-clear">
              {t.events.clear}
            </a>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="site-muted">{t.gallery.empty}</p>
      ) : (
        <AlbumCards items={items} t={t} />
      )}
      {pages > 1 && (
        <SitePager
          page={page}
          pages={pages}
          hrefOf={(n) => albumsHref(query, n)}
          label={t.news.pagination}
        />
      )}
    </>
  );
}
