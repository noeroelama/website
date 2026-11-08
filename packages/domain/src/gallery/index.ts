import { z } from "zod";
import { safeId } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { type EventType } from "../events";
import { isValidSlug, type EntityMeta } from "../shared";

export const ALBUM_MAX_IMAGES = 10;

export interface Album extends EntityMeta {
  readonly slug: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: EventType | null;
  readonly eventStartsAt: Date | null;
  readonly eventTimezone: string | null;
  readonly eventLocation: string | null;
  readonly eventDescription: string | null;
  readonly images: readonly FeaturedImage[];
  readonly totalPhotos: number | null;
  readonly albumUrl: string;
  readonly published: boolean;
}

export function canHaveAlbum(event: { published: boolean; deletedAt: Date | null }): boolean {
  return event.published && event.deletedAt === null;
}

export const AlbumInputSchema = z
  .object({
    eventId: safeId,
    images: z
      .array(FeaturedImageSchema)
      .min(1, "Add at least one image.")
      .max(ALBUM_MAX_IMAGES, `At most ${ALBUM_MAX_IMAGES} images.`),
    totalPhotos: z.number({ error: "Enter the total number of photos/videos." }).int().min(0),
    albumUrl: z
      .string()
      .trim()
      .max(2000)
      .regex(/^https?:\/\/\S+$/i, "Paste the album link (http:// or https://)."),
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
  })
  .strict();
export type AlbumInput = z.infer<typeof AlbumInputSchema>;

export interface PublicAlbum {
  readonly slug: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: EventType | null;
  readonly eventStartsAt: Date | null;
  readonly eventTimezone: string | null;
  readonly eventLocation: string | null;
  readonly eventDescription: string | null;
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
    eventType: album.eventType,
    eventStartsAt: album.eventStartsAt,
    eventTimezone: album.eventTimezone,
    eventLocation: album.eventLocation,
    eventDescription: album.eventDescription,
    cover: album.images[0] ?? null,
    images: album.images,
    photoCount: album.totalPhotos ?? album.images.length,
    albumUrl: album.albumUrl,
    updatedAt: album.updatedAt,
  };
}
