import type { FeaturedImage } from "@website/domain/content";
import type { Album } from "@website/domain/gallery";
import type { Author } from "./authors";

export type AlbumStatus = "published" | "draft";

export interface AlbumItem {
  id: string;
  version: number;
  eventId: string;
  event: string;
  eventType: string;
  total: number | null;
  photoCount: number;
  url: string;
  albumLink: string;
  images: FeaturedImage[];
  status: AlbumStatus;
  modifiedAt: string;
  author: Author | null;
}

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
