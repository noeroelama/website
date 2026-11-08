import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlChapterReader } from "@website/db/sql";
import type { PublicChapter } from "@website/domain/organizations";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlChapterReader(webDb()));

export async function activeChapters(): Promise<PublicChapter[]> {
  "use cache";
  cacheTag("chapters");
  cacheLife("minutes");
  return reader().listActive();
}
