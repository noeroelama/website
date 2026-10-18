import type { Firestore } from "firebase-admin/firestore";
import type { Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import {
  toPublicChapter,
  type Chapter,
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
  };
}

/** `chapters/{id}` + `chapterSlugs/{slug}`. Chapters are deactivated, never deleted. */
const chapters = (db: Firestore) =>
  createSluggedStore<Chapter>(db, {
    collection: "chapters",
    slug: { collection: "chapterSlugs", key: (c) => c.slug },
    fromDoc: toChapter,
    snapshot: chapterSnapshot,
    fixed: () => ({}),
  });

/** Admin store (Organizations → PPI). */
export function createFirestoreChapterStore(db: Firestore) {
  const store = chapters(db);
  return {
    /** Every chapter (active and inactive), by name. */
    async listForAdmin(): Promise<Chapter[]> {
      const snapshot = await store.docs.orderBy("name").get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },
    get: store.get,
    write: store.write,
  };
}

export type FirestoreChapterStore = ReturnType<typeof createFirestoreChapterStore>;

/**
 * Active chapters for the website (role web_ro): ONE list drives the map markers, the member
 * councils on About and the chapter count, so they can never disagree.
 */
export function createFirestoreChapterReader(db: Firestore) {
  const store = chapters(db);
  return {
    async listActive(): Promise<PublicChapter[]> {
      const snapshot = await store.docs.where("active", "==", true).orderBy("name").get();
      return snapshot.docs.map((doc) => toPublicChapter(store.read(doc.id, doc.data())));
    },
  };
}

export type FirestoreChapterReader = ReturnType<typeof createFirestoreChapterReader>;
