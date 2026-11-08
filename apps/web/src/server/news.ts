import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlNewsReader } from "@website/db/sql";
import type { PublicNews, PublicNewsDetail } from "@website/domain/content";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlNewsReader(webDb()));

export async function publicNews(): Promise<PublicNews[]> {
  "use cache";
  cacheTag("news");
  cacheLife("minutes");
  return reader().listVisible(new Date());
}

export async function publicNewsBySlug(slug: string): Promise<PublicNewsDetail | null> {
  "use cache";
  cacheTag("news");
  cacheLife("minutes");
  return reader().findBySlug(slug, new Date());
}
