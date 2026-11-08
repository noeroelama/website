import { NEWS_CATEGORIES, type NewsCategory, type PublicNews } from "@website/domain/content";

export const NEWS_PAGE_SIZE = 12;

export const NEWS_TIME_RANGES = ["week", "month", "year"] as const;
export type NewsTime = (typeof NEWS_TIME_RANGES)[number];

export function newsTimeBounds(time: NewsTime, now: Date): string | null {
  const add = (days: number) =>
    new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  if (time === "week") return add(-7);
  if (time === "month") return add(-30);
  return `${now.getFullYear()}-01-01`;
}

export interface NewsQuery {
  readonly category: NewsCategory | null;
  readonly tag: string | null;
  readonly q: string | null;
  readonly time: NewsTime | null;
  readonly page: number;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const isNewsTime = (value: string | undefined): value is NewsTime =>
  NEWS_TIME_RANGES.find((range) => range === value) !== undefined;

export function newsQuery(params: Record<string, string | string[] | undefined>): NewsQuery {
  const category = one(params["category"]);
  const tag = one(params["tag"])?.trim().toLowerCase();
  const q = one(params["q"])?.trim().toLowerCase();
  const time = one(params["time"]);
  const page = Number(one(params["page"]));
  return {
    category: NEWS_CATEGORIES.find((c) => c === category) ?? null,
    tag: tag && tag.length <= 30 ? tag : null,
    q: q && q.length <= 60 ? q : null,
    time: isNewsTime(time) ? time : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function pageOfNews(all: readonly PublicNews[], query: NewsQuery, now = new Date()) {
  const q = query.q?.toLowerCase() ?? null;
  const from = query.time === null ? null : newsTimeBounds(query.time, now);
  const matching = all.filter(
    (n) =>
      (query.category === null || n.category === query.category) &&
      (query.tag === null || n.tags.includes(query.tag)) &&
      (q === null || n.title.toLowerCase().includes(q) || n.author.toLowerCase().includes(q)) &&
      (from === null || (n.publishAt !== null && n.publishAt.toISOString().slice(0, 10) >= from)),
  );
  const pages = Math.max(1, Math.ceil(matching.length / NEWS_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    items: matching.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE),
    count: matching.length,
    page,
    pages,
  };
}

export function newsHref(query: NewsQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  if (query.q) params.set("q", query.q);
  if (query.time) params.set("time", query.time);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/news?${search}` : "/news";
}
