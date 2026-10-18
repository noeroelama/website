import type { FeaturedImage } from "@website/domain/content";
import type { Album } from "@website/domain/gallery";

/**
 * What the Gallery page shows and edits, mapped on the server from `galleries/{id}`. The page
 * lists, filters and pages these rows in the browser (at most the 500 most recently changed).
 */
export type AlbumStatus = "published" | "draft";

export interface AlbumItem {
  id: string;
  version: number;
  eventId: string;
  /** Event title at the time the album was saved. */
  event: string;
  /** "Total photos" as typed (null = not given). */
  total: number | null;
  /** What the site shows: total, or the number of featured images. */
  photoCount: number;
  /** Public slug, e.g. "simposium-2026" (/gallery/<slug>). */
  url: string;
  albumLink: string;
  images: FeaturedImage[];
  status: AlbumStatus;
  /** ISO timestamp of the last change. */
  modifiedAt: string;
}

/** A published event the album can be attached to (the form's event picker). */
export interface AlbumEventOption {
  id: string;
  title: string;
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function toAlbumItem(a: Album): AlbumItem {
  return {
    id: a.id,
    version: a.version,
    eventId: a.eventId,
    event: a.eventTitle,
    total: a.totalPhotos,
    photoCount: a.totalPhotos ?? a.images.length,
    url: a.slug,
    albumLink: a.albumUrl,
    images: [...a.images],
    status: a.published ? "published" : "draft",
    modifiedAt: a.updatedAt.toISOString(),
  };
}
