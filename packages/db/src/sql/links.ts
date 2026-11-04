import type { AuditEvent, Snapshot } from "@website/audit";
import { shortLinkId, type ShortLink, type ShortenerProvider } from "@website/domain/links";
import { createSluggedStore, toDate } from "./slugged";
import type { Database } from "./store";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type ShortLinkFields = Omit<ShortLink, Meta>;

export type ShortLinkAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: ShortLink | null,
  next: ShortLink,
) => AuditEvent;

const toLink = (id: string, data: Record<string, unknown>): ShortLink => ({
  id,
  provider: data["provider"] as ShortenerProvider,
  ref: data["ref"] as string,
  slug: data["slug"] as string,
  shortUrl: data["shortUrl"] as string,
  longUrl: data["longUrl"] as string,
  title: data["title"] as string,
  source: data["source"] as string,
  createdBy: (data["createdBy"] as string | null) ?? null,
  archivedAt: toDate(data["archivedAt"]),
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

/**
 * `shortLinks/{id}` (K1): every short link made, by people and by the system, with the index
 * `shortLinkSlugs/{provider}_{slug}` (one record per provider slug). Archive is a flag (the
 * provider keeps the slug); records are never deleted.
 */
export function createSqlShortLinkStore(db: Database) {
  const store = createSluggedStore<ShortLink>(db, {
    collection: "shortLinks",
    slug: {
      collection: "shortLinkSlugs",
      key: (l) => shortLinkId(l.provider, l.slug),
      taken: "This short URL is already recorded.",
    },
    fromDoc: toLink,
    snapshot: (l) => ({ title: l.title, archivedAt: l.archivedAt?.toISOString() ?? null }),
    fixed: (l) => ({
      provider: l.provider,
      ref: l.ref,
      slug: l.slug,
      shortUrl: l.shortUrl,
      longUrl: l.longUrl,
      source: l.source,
      createdBy: l.createdBy,
      archivedAt: l.archivedAt,
    }),
  });
  return {
    get: store.get,
    /** Newest first (the Tools page list). */
    async list(limit = 500): Promise<ShortLink[]> {
      const snapshot = await store.docs.orderBy("createdAt", "desc").limit(limit).get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },
    write(
      id: string | null,
      version: number | null,
      build: (current: ShortLink | null) => ShortLinkFields,
      audit: ShortLinkAudit,
      now: Date,
    ) {
      return store.write(id, version, build, audit, now);
    },
  };
}

export type SqlShortLinkStore = ReturnType<typeof createSqlShortLinkStore>;
