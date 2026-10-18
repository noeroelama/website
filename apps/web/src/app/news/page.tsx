import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { NEWS_CATEGORIES } from "@website/domain/content";
import { NewsCards } from "@/components/news-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { newsHref, newsQuery, pageOfNews } from "@/lib/news-query";
import { publicNews } from "@/server/news";

export const metadata: Metadata = { title: "News" };

// Static shell (title); the filtered list streams in (query string + cached news).
export default function NewsPage({ searchParams }: PageProps<"/news">) {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.news}</h1>} />
      <Suspense fallback={null}>
        <NewsList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function NewsList({ searchParams }: Pick<PageProps<"/news">, "searchParams">) {
  const query = newsQuery(await searchParams);
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  const { items, page, pages } = pageOfNews(await publicNews(), query);
  return (
    <>
      <form className="site-filters" action="/news">
        <label>
          {t.news.category}{" "}
          <select className="ui-input" name="category" defaultValue={query.category ?? ""}>
            <option value="">{t.news.allCategories}</option>
            {NEWS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.news.categories[c]}
              </option>
            ))}
          </select>
        </label>
        {query.tag && <input type="hidden" name="tag" value={query.tag} />}
        <button className="ui-button" type="submit">
          {t.news.filter}
        </button>
        {query.tag && (
          <span>
            {t.news.tagged}: #{query.tag}
          </span>
        )}
        {(query.category || query.tag) && <a href="/news">{t.news.clear}</a>}
      </form>
      {items.length === 0 ? (
        <p>{t.news.empty}</p>
      ) : (
        <NewsCards items={items} t={t} language={language} />
      )}
      {pages > 1 && (
        <nav className="site-pager">
          {page > 1 && <a href={newsHref(query, page - 1)}>{t.news.previous}</a>}
          <span>
            {page} / {pages}
          </span>
          {page < pages && <a href={newsHref(query, page + 1)}>{t.news.next}</a>}
        </nav>
      )}
    </>
  );
}
