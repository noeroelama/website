import type { FeaturedImage } from "@website/domain/content";
import type { Album } from "@website/domain/gallery";
import type { Author } from "./authors";

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
  /** The event's type label (e.g. "Symposium"); "" when the event is gone. */
  eventType: string;
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
  /** Who made the last change (from the audit log); null when unknown. */
  author: Author | null;
}

/** A published event the album can be attached to (the form's event picker). */
export interface AlbumEventOption {
  id: string;
  title: string;
}

export function toAlbumItem(a: Album, eventType: string, author: Author | null): AlbumItem {
  return {
    id: a.id,
    version: a.version,
    eventId: a.eventId,
    event: a.eventTitle,
    eventType,
    total: a.totalPhotos,
    photoCount: a.totalPhotos ?? a.images.length,
    url: a.slug,
    albumLink: a.albumUrl,
    images: [...a.images],
    status: a.published ? "published" : "draft",
    modifiedAt: a.updatedAt.toISOString(),
    author,
  };
}
