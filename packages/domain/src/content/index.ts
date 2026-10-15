import type { EntityMeta } from "../shared";

export type ContentKind = "news" | "article" | "page";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export interface ContentItem extends EntityMeta {
  readonly kind: ContentKind;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly status: ContentStatus;
  readonly publishAt: Date | null;
  readonly chapterId: string | null;
}

/**
 * Scheduled publishing is a read-time rule, not a cron job:
 * an item is public once it is scheduled/published and publishAt has passed.
 */
export function isPubliclyVisible(
  item: Pick<ContentItem, "status" | "publishAt" | "deletedAt">,
  now: Date,
): boolean {
  if (item.deletedAt !== null) return false;
  if (item.status === "published") return item.publishAt === null || item.publishAt <= now;
  if (item.status === "scheduled") return item.publishAt !== null && item.publishAt <= now;
  return false;
}

/** Repository port — implemented in @website/db. */
export interface ContentReader {
  findPublishedBySlug(kind: ContentKind, slug: string, now: Date): Promise<ContentItem | null>;
}
export interface ContentWriter extends ContentReader {
  /** Must fail with ConcurrencyConflictError when expectedVersion is stale. */
  save(item: ContentItem, expectedVersion: number | null): Promise<ContentItem>;
}
