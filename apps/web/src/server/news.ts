import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createFirestoreNewsReader } from "@website/db/firestore";
import type { PublicNews, PublicNewsDetail } from "@website/domain/content";
import { webDb } from "./db";

const reader = lazyEnv(() => createFirestoreNewsReader(webDb()));

/**
 * Visible news, newest first (shared by Home, /news and the related list). Cached for minutes
 * under the tag "news": a scheduled article appears at most a few minutes after its date.
 */
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
