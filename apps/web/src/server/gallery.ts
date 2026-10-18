import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createFirestoreGalleryReader } from "@website/db/firestore";
import type { PublicAlbum } from "@website/domain/gallery";
import { webDb } from "./db";

const reader = lazyEnv(() => createFirestoreGalleryReader(webDb()));

/** Published albums, newest change first (cached for minutes under the tag "gallery"). */
export async function publicAlbums(): Promise<PublicAlbum[]> {
  "use cache";
  cacheTag("gallery");
  cacheLife("minutes");
  return reader().listPublished();
}

export async function publicAlbumBySlug(slug: string): Promise<PublicAlbum | null> {
  "use cache";
  cacheTag("gallery");
  cacheLife("minutes");
  return reader().findPublishedBySlug(slug);
}

/** The album linked from an event page whose registration has closed. */
export async function publicAlbumForEvent(eventId: string): Promise<PublicAlbum | null> {
  "use cache";
  cacheTag("gallery");
  cacheLife("minutes");
  return reader().findPublishedByEvent(eventId);
}
