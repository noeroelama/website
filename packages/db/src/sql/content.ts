import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import {
  isPubliclyVisible,
  toPublicNews,
  type ContentItem,
  type ContentKind,
  type FeaturedImage,
  type NewsCategory,
  type PublicNews,
  type PublicNewsDetail,
} from "@website/domain/content";
import { createSluggedStore, toDate } from "./slugged";

export type ContentFields = Omit<ContentItem, "id" | "version" | "createdAt" | "updatedAt">;

function toItem(id: string, data: Record<string, unknown>): ContentItem {
  return {
    id,
    kind: data["kind"] as ContentKind,
    slug: data["slug"] as string,
    title: data["title"] as string,
    body: data["body"] as string,
    status: data["status"] as ContentItem["status"],
    publishAt: toDate(data["publishAt"]),
    chapterId: data["chapterId"] as string | null,
    author: data["author"] as string,
    category: data["category"] as NewsCategory,
    summary: data["summary"] as string,
    tags: data["tags"] as string[],
    featuredImage: data["featuredImage"] as FeaturedImage | null,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function contentSnapshot(item: ContentFields): Snapshot {
  return {
    title: item.title,
    slug: item.slug,
    author: item.author,
    category: item.category,
    summary: item.summary,
    tags: [...item.tags],
    body: item.body,
    featuredImage: item.featuredImage ? { ...item.featuredImage } : null,
    status: item.status,
    publishAt: item.publishAt ? item.publishAt.toISOString() : null,
  };
}

export function createSqlContentStore(db: Database) {
  const store = createSluggedStore<ContentItem>(db, {
    collection: "content",
    slug: { collection: "contentSlugs", key: (item) => `${item.kind}_${item.slug}` },
    fromDoc: toItem,
    snapshot: contentSnapshot,
    fixed: (item) => ({ kind: item.kind, chapterId: item.chapterId }),
  });

  return {
    async listForAdmin(kind: ContentKind, limit = 500): Promise<ContentItem[]> {
      const snapshot = await store.docs
        .where("kind", "==", kind)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((item) => item.deletedAt === null);
    },

    get: store.get,

    async findPublishedBySlug(kind: ContentKind, slug: string, now: Date) {
      const item = await store.findBySlugKey(`${kind}_${slug}`);
      return item && isPubliclyVisible(item, now) ? item : null;
    },

    write: store.write,
  };
}

export type SqlContentStore = ReturnType<typeof createSqlContentStore>;

export function createSqlNewsReader(db: Database) {
  const store = createSqlContentStore(db);
  return {
    async listVisible(now: Date, limit = 300): Promise<PublicNews[]> {
      const snapshot = await db
        .collection("content")
        .where("kind", "==", "news")
        .where("publishAt", "<=", now.toISOString())
        .orderBy("publishAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => toItem(doc.id, doc.data()))
        .filter((item) => isPubliclyVisible(item, now))
        .map(toPublicNews);
    },

    async findBySlug(slug: string, now: Date): Promise<PublicNewsDetail | null> {
      const item = await store.findPublishedBySlug("news", slug, now);
      return item && { ...toPublicNews(item), body: item.body };
    },
  };
}

export type SqlNewsReader = ReturnType<typeof createSqlNewsReader>;
