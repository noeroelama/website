import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { sanitizeRichText } from "@website/security/html";
import { NewsCards } from "@/components/news-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventDate } from "@/lib/event-time";
import { publicNews, publicNewsBySlug } from "@/server/news";

// Unknown, draft, future or deleted slug → the 404 page. With Cache Components the response has
// already started streaming, so the status stays 200 and Next adds `noindex` (a soft 404; a real
// 404 status would need a database read in proxy.ts for every request).
export const instant = false;

const find = async (slug: string) => (isValidSlug(slug) ? publicNewsBySlug(slug) : null);

export async function generateMetadata({ params }: PageProps<"/news/[slug]">): Promise<Metadata> {
  const item = await find((await params).slug);
  if (!item) return {};
  return {
    title: item.title,
    description: item.summary || undefined,
    openGraph: {
      title: item.title,
      description: item.summary || undefined,
      images: item.featuredImage ? [item.featuredImage.url] : [],
    },
  };
}

export default async function NewsArticlePage({ params }: PageProps<"/news/[slug]">) {
  const item = await find((await params).slug);
  if (!item) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language];
  // Recent News: the three newest articles, the current one excluded (user).
  const recent = (await publicNews()).filter((n) => n.slug !== item.slug).slice(0, 3);
  return (
    // Same frame as the news list (user): black page, 74rem column, cream text;
    // the Recent News cards inherit the black-page card styles.
    <main className="site-lists site-lists--news">
      <div className="site-lists__inner">
        <a className="site-article__back" href="/news">
          ← {t.news.backToArticles}
        </a>
        <h1 className="site-lists__title">{item.title}</h1>
        <p className="site-article__meta">
          {formatEventDate(item.publishAt, "UTC")}
          <span aria-hidden="true">•</span>
          {t.news.categories[item.category]}
        </p>
        {item.featuredImage && (
          // eslint-disable-next-line @next/next/no-img-element -- Storage serves scaled WebP
          <img
            className="site-article__banner"
            src={item.featuredImage.url}
            width={item.featuredImage.width}
            height={item.featuredImage.height}
            alt=""
          />
        )}
        <div
          className="site-article__body"
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.body) }}
        />
        {recent.length > 0 && (
          <section className="site-article__recent">
            <h2 className="site-article__heading">{t.news.recentNews}</h2>
            <NewsCards items={recent} t={t} />
          </section>
        )}
      </div>
    </main>
  );
}
