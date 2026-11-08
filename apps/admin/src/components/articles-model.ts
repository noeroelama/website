import {
  isPubliclyVisible,
  type ContentItem,
  type FeaturedImage,
  type NewsCategory,
} from "@website/domain/content";
import { label, NEWS_CATEGORY_LABELS } from "../labels";
import { toAuthor, type Author } from "./authors";

export type ArticleStatus = "published" | "scheduled" | "draft";
export type ArticleTab = "all" | "published" | "drafts";

export interface ArticleItem {
  id: string;
  version: number;
  title: string;
  categoryKey: NewsCategory;
  category: string;
  author: string;
  byline: Author | null;
  editor: Author | null;
  image: string;
  featuredImage: FeaturedImage | null;
  status: ArticleStatus;
  modifiedAt: string;
  publishAt: string | null;
  url: string;
  excerpt: string;
  tags: string[];
  body: string;
  createdAt: string;
}

const SETTINGS_FIELDS = ["title", "category", "publishAt", "slug", "summary", "tags"];

export function needsSettings(fields: Readonly<Record<string, string>>): boolean {
  return SETTINGS_FIELDS.some((field) => field in fields);
}

export function matchesArticleTab(a: ArticleItem, tab: ArticleTab): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return a.status === "draft";
  return a.status !== "draft";
}

export function articleStatus(
  item: Pick<ContentItem, "status" | "publishAt" | "deletedAt">,
  now: Date,
): ArticleStatus {
  if (item.status !== "published" && item.status !== "scheduled") return "draft";
  return isPubliclyVisible(item, now) ? "published" : "scheduled";
}

export function toArticleItem(item: ContentItem, now: Date, editor: Author | null): ArticleItem {
  const author = item.author.trim();
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    categoryKey: item.category,
    category: label(NEWS_CATEGORY_LABELS, item.category),
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
