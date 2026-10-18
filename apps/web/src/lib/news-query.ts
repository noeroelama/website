import { NEWS_CATEGORIES, type NewsCategory, type PublicNews } from "@website/domain/content";

export const NEWS_PAGE_SIZE = 12;

export interface NewsQuery {
  readonly category: NewsCategory | null;
  readonly tag: string | null;
  readonly page: number;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** /news?category=…&tag=…&page=… → a safe query; anything unknown is ignored. */
export function newsQuery(params: Record<string, string | string[] | undefined>): NewsQuery {
  const category = one(params["category"]);
  const tag = one(params["tag"])?.trim().toLowerCase();
  const page = Number(one(params["page"]));
  return {
    category: NEWS_CATEGORIES.find((c) => c === category) ?? null,
    tag: tag && tag.length <= 30 ? tag : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Filters (category AND tag) and pages the visible news; `pages` is at least 1. */
export function pageOfNews(all: readonly PublicNews[], query: NewsQuery) {
  const matching = all.filter(
    (n) =>
      (query.category === null || n.category === query.category) &&
      (query.tag === null || n.tags.includes(query.tag)),
  );
  const pages = Math.max(1, Math.ceil(matching.length / NEWS_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    items: matching.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE),
    page,
    pages,
  };
}

/** Link to another page of the same filtered list. */
export function newsHref(query: NewsQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/news?${search}` : "/news";
}
