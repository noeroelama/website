import {
  isPubliclyVisible,
  type ContentItem,
  type FeaturedImage,
  type NewsCategory,
} from "@website/domain/content";
import { label, NEWS_CATEGORY_LABELS } from "../labels";
import { toAuthor, type Author } from "./authors";

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
  /** Where the news happened (the public cards show "date • location • category"). */
  location: string;
  /** The stored byline (sent back unchanged on save). */
  author: string;
  /** The byline for the Author column ("Nevyllo K." / "NK"); null when empty. */
  byline: Author | null;
  /** Who made the last change (from the audit log), shown under Last Modified; null when unknown. */
  editor: Author | null;
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

/** Save fields edited in the Settings panel (the editor page only has the image and the content). */
const SETTINGS_FIELDS = ["title", "category", "location", "publishAt", "slug", "summary", "tags"];

/** True when the server refused a Settings field, so the editor opens the Settings panel. */
export function needsSettings(fields: Readonly<Record<string, string>>): boolean {
  return SETTINGS_FIELDS.some((field) => field in fields);
}

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
export function toArticleItem(item: ContentItem, now: Date, editor: Author | null): ArticleItem {
  const author = item.author.trim();
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    categoryKey: item.category,
    category: label(NEWS_CATEGORY_LABELS, item.category),
    location: item.location ?? "",
    author,
    byline: toAuthor(author, null),
    editor,
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
