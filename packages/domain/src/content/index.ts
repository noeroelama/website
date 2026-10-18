import { z } from "zod";
import { safeText } from "@website/security/validation";
import { isValidSlug, type EntityMeta } from "../shared";

export type ContentKind = "news" | "article" | "page";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

/** News categories (Figma flowchart); labels live in the apps' label maps. */
export const NEWS_CATEGORIES = [
  "general",
  "academic",
  "community",
  "announcement",
  "international",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** An uploaded image as returned by the image pipeline (public preset). */
export interface FeaturedImage {
  readonly url: string;
  readonly thumbUrl: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly width: number;
  readonly height: number;
}

export interface ContentItem extends EntityMeta {
  readonly kind: ContentKind;
  readonly slug: string;
  readonly title: string;
  /** Sanitised rich text (HTML allowlist, `@website/security/html`). */
  readonly body: string;
  readonly status: ContentStatus;
  readonly publishAt: Date | null;
  readonly chapterId: string | null;
  /** Byline as typed by staff (the staff account is in the audit log). */
  readonly author: string;
  readonly category: NewsCategory;
  readonly summary: string;
  /** Lower-case keywords; drive the related articles. */
  readonly tags: readonly string[];
  readonly featuredImage: FeaturedImage | null;
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

/** What the editor asked for: keep as draft, or publish (now, or scheduled for a future date). */
export type PublishIntent = "draft" | "publish";

export function publishState(
  intent: PublishIntent,
  publishAt: Date | null,
  now: Date,
): { status: ContentStatus; publishAt: Date | null } {
  if (intent === "draft") return { status: "draft", publishAt };
  if (publishAt !== null && publishAt > now) return { status: "scheduled", publishAt };
  return { status: "published", publishAt: publishAt ?? now };
}

/** URL slug from a title: lower case, accents removed, words joined by dashes, ≤ 120 chars. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/** Publish date as shown on the site and the admin preview, e.g. "18 Oktober 2026" (UTC). */
export function formatNewsDate(date: Date, language: "id" | "en"): string {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);
const storagePath = z
  .string()
  .max(300)
  .regex(/^[a-z0-9/_-]+\.webp$/);

export const FeaturedImageSchema = z
  .object({
    url: httpsUrl,
    thumbUrl: httpsUrl,
    path: storagePath,
    thumbPath: storagePath,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

/** The News form (add + edit). The body is sanitised by the server before it is stored. */
export const NewsInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    /** Empty = built from the title. */
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
    author: safeText(120).pipe(z.string().min(2, "Enter the author.")),
    category: z.enum(NEWS_CATEGORIES, { error: "Choose a category." }),
    publishAt: z.coerce.date().nullable(),
    summary: safeText(500, { multiline: true, allowEmpty: true }),
    tags: z
      .array(z.string().max(30))
      .max(10, "At most 10 tags.")
      .transform((tags) => normalizeTags(tags)),
    body: z.string().max(200_000),
    featuredImage: FeaturedImageSchema.nullable(),
  })
  .strict();
export type NewsInput = z.infer<typeof NewsInputSchema>;

/** What visitors may see of a news item (list cards); the detail page adds the body. */
export interface PublicNews {
  readonly slug: string;
  readonly title: string;
  readonly author: string;
  readonly category: NewsCategory;
  readonly summary: string;
  readonly tags: readonly string[];
  /** When it went public (for published items saved without a date: the last change). */
  readonly publishAt: Date;
  readonly featuredImage: FeaturedImage | null;
}
export interface PublicNewsDetail extends PublicNews {
  /** Stored sanitised HTML; sanitise again when rendering. */
  readonly body: string;
}

export function toPublicNews(item: ContentItem): PublicNews {
  return {
    slug: item.slug,
    title: item.title,
    author: item.author,
    category: item.category,
    summary: item.summary,
    tags: item.tags,
    publishAt: item.publishAt ?? item.updatedAt,
    featuredImage: item.featuredImage,
  };
}

/** Related articles: up to `limit` others with the same category or a shared tag, newest first. */
export function relatedNews(
  current: PublicNews,
  all: readonly PublicNews[],
  limit = 3,
): PublicNews[] {
  return all
    .filter(
      (n) =>
        n.slug !== current.slug &&
        (n.category === current.category || n.tags.some((tag) => current.tags.includes(tag))),
    )
    .sort((a, b) => b.publishAt.getTime() - a.publishAt.getTime())
    .slice(0, limit);
}

/** Repository port — implemented in @website/db. */
export interface ContentReader {
  findPublishedBySlug(kind: ContentKind, slug: string, now: Date): Promise<ContentItem | null>;
}
export interface ContentWriter extends ContentReader {
  /** Must fail with ConcurrencyConflictError when expectedVersion is stale. */
  save(item: ContentItem, expectedVersion: number | null): Promise<ContentItem>;
}
