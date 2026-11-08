import { z } from "zod";
import { safeText } from "@website/security/validation";
import { isValidSlug, type EntityMeta } from "../shared";

export type ContentKind = "news" | "article" | "page";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export const NEWS_CATEGORIES = [
  "general",
  "academic",
  "community",
  "announcement",
  "international",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

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
  readonly body: string;
  readonly status: ContentStatus;
  readonly publishAt: Date | null;
  readonly chapterId: string | null;
  readonly author: string;
  readonly category: NewsCategory;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly featuredImage: FeaturedImage | null;
}

export function isPubliclyVisible(
  item: Pick<ContentItem, "status" | "publishAt" | "deletedAt">,
  now: Date,
): boolean {
  if (item.deletedAt !== null) return false;
  if (item.status === "published") return item.publishAt === null || item.publishAt <= now;
  if (item.status === "scheduled") return item.publishAt !== null && item.publishAt <= now;
  return false;
}

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

export function formatNewsDate(date: Date, language: "id" | "en"): string {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

const httpsUrl = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine((u) => u.startsWith("https://") || /^http:\/\/localhost[:/]/.test(u), "Use https.");
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

export const NewsInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    slug: z
      .string()
      .trim()
      .min(1, { error: "Enter the URL.", abort: true })
      .max(120)
      .refine(isValidSlug, "Use lower-case letters, numbers and dashes."),
    author: safeText(120).pipe(z.string().min(2, "Enter the author.")),
    category: z.enum(NEWS_CATEGORIES, { error: "Choose a category." }),
    publishAt: z.coerce
      .date()
      .nullable()
      .refine((date) => date !== null, "Choose the publish date and time."),
    summary: safeText(500, { multiline: true, allowEmpty: true }).pipe(
      z.string().min(1, "Write a short summary."),
    ),
    tags: z
      .array(z.string().max(30))
      .max(10, "At most 10 tags.")
      .transform((tags) => normalizeTags(tags)),
    body: z.string().max(200_000),
    featuredImage: FeaturedImageSchema.nullable().refine(
      (image) => image !== null,
      "Add a featured image.",
    ),
  })
  .strict();
export type NewsInput = z.infer<typeof NewsInputSchema>;

export interface PublicNews {
  readonly slug: string;
  readonly title: string;
  readonly author: string;
  readonly category: NewsCategory;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly publishAt: Date;
  readonly featuredImage: FeaturedImage | null;
}
export interface PublicNewsDetail extends PublicNews {
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

export interface ContentReader {
  findPublishedBySlug(kind: ContentKind, slug: string, now: Date): Promise<ContentItem | null>;
}
export interface ContentWriter extends ContentReader {
  save(item: ContentItem, expectedVersion: number | null): Promise<ContentItem>;
}
