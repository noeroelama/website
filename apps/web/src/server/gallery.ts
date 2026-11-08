import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlGalleryReader } from "@website/db/sql";
import type { PublicAlbum } from "@website/domain/gallery";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlGalleryReader(webDb()));

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

export async function publicAlbumForEvent(eventId: string): Promise<PublicAlbum | null> {
  "use cache";
  cacheTag("gallery");
  cacheLife("minutes");
  return reader().findPublishedByEvent(eventId);
}
