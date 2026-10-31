import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import {
  toPublicChapter,
  type Chapter,
  type ChapterRisk,
  type PublicChapter,
  type SocialLink,
} from "@website/domain/organizations";
import { createSluggedStore, toDate } from "./slugged";

export type ChapterFields = Omit<Chapter, "id" | "version" | "createdAt" | "updatedAt">;

function toChapter(id: string, data: Record<string, unknown>): Chapter {
  return {
    id,
    slug: data["slug"] as string,
    name: data["name"] as string,
    countryCode: data["countryCode"] as string,
    active: data["active"] as boolean,
    timezone: data["timezone"] as string,
    logo: data["logo"] as FeaturedImage | null,
    contactName: data["contactName"] as string,
    contactPublic: data["contactPublic"] as string,
    website: data["website"] as string | null,
    email: data["email"] as string | null,
    instagram: data["instagram"] as string | null,
    socials: data["socials"] as SocialLink[],
    latitude: data["latitude"] as number,
    longitude: data["longitude"] as number,
    // Chapters saved before these fields existed read as "nothing entered yet".
    memberCount: (data["memberCount"] as number | undefined) ?? 0,
    conditions: (data["conditions"] as string[] | undefined) ?? [],
    risk: (data["risk"] as ChapterRisk | undefined) ?? "none",
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function chapterSnapshot(c: ChapterFields): Snapshot {
  return {
    slug: c.slug,
    name: c.name,
    countryCode: c.countryCode,
    active: c.active,
    timezone: c.timezone,
    logo: c.logo ? { ...c.logo } : null,
    contactName: c.contactName,
    contactPublic: c.contactPublic,
    website: c.website,
    email: c.email,
    instagram: c.instagram,
    socials: c.socials.map((s) => ({ ...s })),
    latitude: c.latitude,
    longitude: c.longitude,
    memberCount: c.memberCount,
    conditions: [...c.conditions],
    risk: c.risk,
  };
}

/**
 * `chapters/{id}` + `chapterSlugs/{slug}`. A delete is soft (`deletedAt`); the slug stays
 * reserved so reverting the delete in the Audit Log brings the chapter back unchanged.
 */
const chapters = (db: Database) =>
  createSluggedStore<Chapter>(db, {
    collection: "chapters",
    slug: { collection: "chapterSlugs", key: (c) => c.slug },
    fromDoc: toChapter,
    snapshot: chapterSnapshot,
    fixed: () => ({}),
  });

/** Admin store (Organizations → PPI). */
export function createSqlChapterStore(db: Database) {
  const store = chapters(db);
  return {
    /** Every chapter that is not deleted (active and inactive), by name. */
    async listForAdmin(): Promise<Chapter[]> {
      const snapshot = await store.docs.orderBy("name").get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data())).filter((c) => !c.deletedAt);
    },
    get: store.get,
    write: store.write,
  };
}

export type SqlChapterStore = ReturnType<typeof createSqlChapterStore>;

/**
 * Active chapters for the website (role web_ro): ONE list drives the map markers, the member
 * councils on About and the chapter count, so they can never disagree.
 */
export function createSqlChapterReader(db: Database) {
  const store = chapters(db);
  return {
    async listActive(): Promise<PublicChapter[]> {
      const snapshot = await store.docs.where("active", "==", true).orderBy("name").get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((c) => !c.deletedAt)
        .map(toPublicChapter);
    },
  };
}

export type SqlChapterReader = ReturnType<typeof createSqlChapterReader>;
