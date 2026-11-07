import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlChapterReader } from "@website/db/sql";
import type { PublicChapter } from "@website/domain/organizations";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlChapterReader(webDb()));

/**
 * Active chapters by name: the /map table, the map markers, the member councils on About
 * and the chapter count all come from this one list (cached for minutes under the tag
 * "chapters"). Deactivated chapters never appear; /map groups the rows by the chapter's
 * own `region` field, so a change in the organization data shows up within minutes.
 */
export async function activeChapters(): Promise<PublicChapter[]> {
  "use cache";
  cacheTag("chapters");
  cacheLife("minutes");
  return reader().listActive();
}
