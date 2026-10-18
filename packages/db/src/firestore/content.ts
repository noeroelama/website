import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  isPubliclyVisible,
  type ContentItem,
  type ContentKind,
  type FeaturedImage,
  type NewsCategory,
} from "@website/domain/content";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";

/** Fields a write may set (the store fills id, version and timestamps). */
export type ContentFields = Omit<ContentItem, "id" | "version" | "createdAt" | "updatedAt">;

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return new Date(value);
  return (value as { toDate(): Date }).toDate();
};

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

/**
 * What the audit log keeps (and a revert writes back). `publishAt` is stored as an ISO string
 * both here and in Firestore, so a reverted value has the same type as a saved one.
 */
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

/**
 * `content/{id}` (news, articles, pages) + `contentSlugs/{kind}_{slug}` → { contentId }, which
 * keeps slugs unique per kind inside the same transaction as the write.
 */
export function createFirestoreContentStore(db: Firestore) {
  const content = db.collection("content");
  const slugs = db.collection("contentSlugs");
  const audit = createFirestoreAuditWriter(db);
  const slugRef = (kind: ContentKind, slug: string) => slugs.doc(safeId.parse(`${kind}_${slug}`));

  return {
    /** Admin list: newest change first, trash excluded (small collections; filtered in code). */
    async listForAdmin(kind: ContentKind, limit = 500): Promise<ContentItem[]> {
      const snapshot = await content
        .where("kind", "==", kind)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => toItem(doc.id, doc.data() as Record<string, unknown>))
        .filter((item) => item.deletedAt === null);
    },

    async get(id: string): Promise<ContentItem | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await content.doc(id).get();
      return snapshot.exists ? toItem(id, snapshot.data() as Record<string, unknown>) : null;
    },

    async findPublishedBySlug(kind: ContentKind, slug: string, now: Date) {
      if (!safeId.safeParse(`${kind}_${slug}`).success) return null;
      const pointer = await slugRef(kind, slug).get();
      if (!pointer.exists) return null;
      const snapshot = await content.doc(pointer.get("contentId") as string).get();
      if (!snapshot.exists) return null;
      const item = toItem(snapshot.id, snapshot.data() as Record<string, unknown>);
      return isPubliclyVisible(item, now) ? item : null;
    },

    /**
     * Creates (id null) or changes one item in ONE transaction: reads it (version check), lets
     * `build` compute the new fields (throw to refuse), reserves the slug, writes the item and its
     * audit entry. Returns the saved item.
     */
    write(
      id: string | null,
      expectedVersion: number | null,
      build: (current: ContentItem | null) => ContentFields,
      auditFor: (
        before: Snapshot | null,
        after: Snapshot | null,
        current: ContentItem | null,
        next: ContentItem,
      ) => AuditEvent,
      now: Date,
    ): Promise<ContentItem> {
      const ref = content.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = id === null ? null : await tx.get(ref);
        if (id !== null && !snapshot?.exists)
          throw new RuleViolationError("This item does not exist.");
        const current = snapshot?.exists
          ? toItem(ref.id, snapshot.data() as Record<string, unknown>)
          : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("content version changed");
        }
        if (current?.deletedAt) throw new RuleViolationError("This item is in the trash.");
        const fields = build(current);
        const slugChanged = current === null || current.slug !== fields.slug;
        if (slugChanged) {
          const taken = await tx.get(slugRef(fields.kind, fields.slug));
          if (taken.exists && taken.get("contentId") !== ref.id) {
            throw new RuleViolationError(
              "This URL is already used by another item. Choose another one.",
            );
          }
        }
        const next: ContentItem = {
          ...fields,
          id: ref.id,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, {
          ...contentSnapshot(next),
          kind: next.kind,
          chapterId: next.chapterId,
          version: next.version,
          createdAt: next.createdAt,
          updatedAt: now,
          deletedAt: next.deletedAt,
        });
        if (slugChanged) {
          tx.set(slugRef(next.kind, next.slug), { contentId: ref.id });
          if (current) tx.delete(slugRef(current.kind, current.slug));
        }
        log.append(
          auditFor(
            current && contentSnapshot(current),
            next.deletedAt ? null : contentSnapshot(next),
            current,
            next,
          ),
        );
        return next;
      });
    },
  };
}

export type FirestoreContentStore = ReturnType<typeof createFirestoreContentStore>;
