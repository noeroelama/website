import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createFirestoreChapterReader } from "@website/db/firestore";
import type { PublicChapter } from "@website/domain/organizations";
import { webDb } from "./db";

const reader = lazyEnv(() => createFirestoreChapterReader(webDb()));

/**
 * Active chapters by name: the map markers, the member councils on About and the chapter count
 * all come from this one list (cached for minutes under the tag "chapters").
 */
export async function activeChapters(): Promise<PublicChapter[]> {
  "use cache";
  cacheTag("chapters");
  cacheLife("minutes");
  return reader().listActive();
}
