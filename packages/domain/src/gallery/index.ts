import { z } from "zod";
import { safeId } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { isValidSlug, type EntityMeta } from "../shared";

/** Most featured images an album shows on the site (the full album is the external link). */
export const ALBUM_MAX_IMAGES = 10;

/** A gallery album: featured photos of one event + a link to the full external album. */
export interface Album extends EntityMeta {
  readonly slug: string;
  readonly eventId: string;
  /** The event's title when the album was saved (lists show it without reading the event). */
  readonly eventTitle: string;
  readonly images: readonly FeaturedImage[];
  /** Number shown on the card; null = the number of featured images. */
  readonly totalPhotos: number | null;
  readonly albumUrl: string;
  readonly published: boolean;
}

/** Albums belong to published events only (flowchart: searchable list of published events). */
export function canHaveAlbum(event: { published: boolean; deletedAt: Date | null }): boolean {
  return event.published && event.deletedAt === null;
}

/** The Gallery form (add + edit). */
export const AlbumInputSchema = z
  .object({
    eventId: safeId,
    images: z
      .array(FeaturedImageSchema)
      .min(1, "Add at least one image.")
      .max(ALBUM_MAX_IMAGES, `At most ${ALBUM_MAX_IMAGES} images.`),
    totalPhotos: z.number().int().min(0).nullable(),
    albumUrl: z
      .string()
      .trim()
      .max(2000)
      .regex(/^https?:\/\/\S+$/i, "Paste the album link (http:// or https://)."),
    /** Empty = the event's URL. */
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
  })
  .strict();
export type AlbumInput = z.infer<typeof AlbumInputSchema>;

/** What visitors see of a published album. */
export interface PublicAlbum {
  readonly slug: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly cover: FeaturedImage | null;
  readonly images: readonly FeaturedImage[];
  readonly photoCount: number;
  readonly albumUrl: string;
  readonly updatedAt: Date;
}

export function toPublicAlbum(album: Album): PublicAlbum {
  return {
    slug: album.slug,
    eventId: album.eventId,
    eventTitle: album.eventTitle,
    cover: album.images[0] ?? null,
    images: album.images,
    photoCount: album.totalPhotos ?? album.images.length,
    albumUrl: album.albumUrl,
    updatedAt: album.updatedAt,
  };
}
