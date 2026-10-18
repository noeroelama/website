import {
  isPubliclyVisible,
  type ContentItem,
  type FeaturedImage,
  type NewsCategory,
} from "@website/domain/content";
import { label, NEWS_CATEGORY_LABELS } from "../labels";

/**
 * What the Article page shows and edits, mapped on the server from `content/{id}` (kind news).
 * The page lists, filters and pages these rows in the browser (at most the 500 most recently
 * changed articles are loaded).
 */
export type ArticleStatus = "published" | "scheduled" | "draft";
export type ArticleTab = "all" | "published" | "drafts";

export interface ArticleItem {
  id: string;
  version: number;
  title: string;
  /** Category key and its label (shown under the title). */
  categoryKey: NewsCategory;
  category: string;
  author: string;
  authorInitials: string;
  /** Thumbnail for the table (empty when there is no featured image). */
  image: string;
  featuredImage: FeaturedImage | null;
  status: ArticleStatus;
  /** ISO timestamp of the last change; the Date cell shows "x ago". */
  modifiedAt: string;
  /** Publish date-time (ISO) or null. */
  publishAt: string | null;
  /** Public slug, e.g. "simposium-berakhir-sukses". */
  url: string;
  /** Short summary. */
  excerpt: string;
  tags: string[];
  /** Sanitised rich text. */
  body: string;
  createdAt: string;
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/** "Published" tab = published and scheduled; "Drafts" tab = drafts. */
export function matchesArticleTab(a: ArticleItem, tab: ArticleTab): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return a.status === "draft";
  return a.status !== "draft";
}

/** Row status: a scheduled article counts as published once its date has passed. */
export function articleStatus(
  item: Pick<ContentItem, "status" | "publishAt" | "deletedAt">,
  now: Date,
): ArticleStatus {
  if (item.status !== "published" && item.status !== "scheduled") return "draft";
  return isPubliclyVisible(item, now) ? "published" : "scheduled";
}

/** Server-side mapping from `content/{id}` to a table row (plain JSON for the client page). */
export function toArticleItem(item: ContentItem, now: Date): ArticleItem {
  const author = item.author.trim();
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    categoryKey: item.category,
    category: label(NEWS_CATEGORY_LABELS, item.category),
    author,
    authorInitials:
      author
        .split(/\s+/)
        .map((word) => word[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "AR",
    image: item.featuredImage?.thumbUrl ?? "",
    featuredImage: item.featuredImage,
    status: articleStatus(item, now),
    modifiedAt: item.updatedAt.toISOString(),
    publishAt: item.publishAt?.toISOString() ?? null,
    url: item.slug,
    excerpt: item.summary,
    tags: [...item.tags],
    body: item.body,
    createdAt: item.createdAt.toISOString(),
  };
}
