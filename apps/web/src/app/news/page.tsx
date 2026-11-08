import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { NEWS_CATEGORIES } from "@website/domain/content";
import { NewsCards } from "@/components/news-cards";
import { FieldIcon } from "@/components/site-field-icon";
import { SitePager } from "@/components/site-pager";
import { SubmitOnChangeSelect } from "@/components/submit-on-change-select";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { newsHref, newsQuery, NEWS_TIME_RANGES, pageOfNews } from "@/lib/news-query";
import { publicNews } from "@/server/news";

export const metadata: Metadata = { title: "News" };

export default function NewsPage({ searchParams }: PageProps<"/news">) {
  return (
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <Localized
          render={(t) => (
            <>
              <h1 className="site-lists__title">{t.pages.news}</h1>
              <p className="site-lists__tagline">{t.news.tagline}</p>
            </>
          )}
        />
        <Suspense fallback={null}>
          <NewsList searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function NewsList({ searchParams }: Pick<PageProps<"/news">, "searchParams">) {
  const query = newsQuery(await searchParams);
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const all = await publicNews();
  const { items, count, page, pages } = pageOfNews(all, query);
  const filtered =
    query.category !== null || query.tag !== null || query.q !== null || query.time !== null;
  return (
    <>
      <form className="site-lists__bar" action="/news" method="get">
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
                  defaultValue={query.time ?? "year"}
                >
                  <option value="">{t.events.allPeriods}</option>
                  {NEWS_TIME_RANGES.map((range) => (
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
              <FieldIcon name="search" className="site-lists__field-label-icon" />
              {t.news.search}
            </span>
            <span className="site-lists__field-controls">
              <span className="site-lists__box">
                <FieldIcon name="search" className="site-lists__box-icon" />
                <input
                  className="ui-input"
                  type="search"
                  name="q"
                  placeholder={t.news.searchPlaceholder}
                  defaultValue={query.q ?? ""}
                />
              </span>
            </span>
          </label>
          {query.tag && <input type="hidden" name="tag" value={query.tag} />}
          <button className="site-lists__bar-submit" type="submit">
            {t.news.search}
          </button>
        </div>
        <hr className="site-lists__bar-divider" />
        <div className="site-lists__pills">
          <span className="site-lists__pills-label">{t.news.category}:</span>
          {[null, ...NEWS_CATEGORIES].map((category) => {
            const active = (query.category ?? null) === category;
            return (
              <a
                className="site-lists__pill"
                aria-current={active ? "true" : undefined}
                href={newsHref({ ...query, category: active ? null : category, page: 1 }, 1)}
                key={category ?? "all"}
              >
                {category === null ? t.news.allCategories : t.news.categories[category]}
              </a>
            );
          })}
          <span className="site-lists__count">
            <FieldIcon name="count" className="site-lists__count-icon" />
            {t.news.showing.replace("{n}", String(count))}
          </span>
          {filtered && (
            <a href="/news" className="site-lists__bar-clear">
              {t.news.clear}
            </a>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="site-muted">{t.news.empty}</p>
      ) : (
        <NewsCards items={items} t={t} />
      )}
      {pages > 1 && (
        <SitePager
          page={page}
          pages={pages}
          hrefOf={(n) => newsHref(query, n)}
          label={t.news.pagination}
        />
      )}
    </>
  );
}
