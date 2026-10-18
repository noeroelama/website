import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { formatNewsDate, relatedNews } from "@website/domain/content";
import { isValidSlug } from "@website/domain/shared";
import { sanitizeRichText } from "@website/security/html";
import { ArticleView } from "@website/ui";
import { NewsCards } from "@/components/news-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { getAppUrls } from "@/server/env";
import { publicNews, publicNewsBySlug } from "@/server/news";

// Unknown, draft, future or deleted slug → the 404 page. With Cache Components the response has
// already started streaming, so the status stays 200 and Next adds `noindex` (a soft 404; a real
// 404 status would need a Firestore read in proxy.ts for every request).
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
  const related = relatedNews(item, await publicNews());
  const url = `${getAppUrls().WEB_URL ?? ""}/news/${item.slug}`;
  const share = [
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${item.title} ${url}`)}`],
    ["X", `https://x.com/intent/post?url=${encodeURIComponent(url)}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`],
  ] as const;
  return (
    <>
      <ArticleView
        title={item.title}
        author={item.author}
        date={formatNewsDate(item.publishAt, language)}
        category={t.news.categories[item.category]}
        image={item.featuredImage}
        safeHtml={sanitizeRichText(item.body)}
        tags={item.tags.map((tag) => ({
          label: tag,
          href: `/news?tag=${encodeURIComponent(tag)}`,
        }))}
      />
      <div className="ui-shell">
        {/* Plain share links: no third-party scripts. */}
        <p className="site-share">
          {t.news.share}:
          {share.map(([name, href]) => (
            <a key={name} href={href} target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          ))}
        </p>
        {related.length > 0 && (
          <section>
            <h2>{t.news.related}</h2>
            <NewsCards items={related} t={t} language={language} />
          </section>
        )}
      </div>
    </>
  );
}
