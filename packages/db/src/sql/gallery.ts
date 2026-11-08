import type { Database, Query } from "./store";
import type { Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import type { EventType } from "@website/domain/events";
import { toPublicAlbum, type Album, type PublicAlbum } from "@website/domain/gallery";
import { createSluggedStore, toDate } from "./slugged";

export type AlbumFields = Omit<Album, "id" | "version" | "createdAt" | "updatedAt">;

function toAlbum(id: string, data: Record<string, unknown>): Album {
  return {
    id,
    slug: data["slug"] as string,
    eventId: data["eventId"] as string,
    eventTitle: data["eventTitle"] as string,
    eventType: (data["eventType"] as EventType | null | undefined) ?? null,
    eventStartsAt: toDate(data["eventStartsAt"]),
    eventTimezone: (data["eventTimezone"] as string | null | undefined) ?? null,
    eventLocation: (data["eventLocation"] as string | null | undefined) ?? null,
    eventDescription: (data["eventDescription"] as string | null | undefined) ?? null,
    images: data["images"] as FeaturedImage[],
    totalPhotos: data["totalPhotos"] as number | null,
    albumUrl: data["albumUrl"] as string,
    published: data["published"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function albumSnapshot(a: AlbumFields): Snapshot {
  return {
    slug: a.slug,
    eventId: a.eventId,
    eventTitle: a.eventTitle,
    eventType: a.eventType,
    eventStartsAt: a.eventStartsAt?.toISOString() ?? null,
    eventTimezone: a.eventTimezone,
    eventLocation: a.eventLocation,
    eventDescription: a.eventDescription,
    images: a.images.map((image) => ({ ...image })),
    totalPhotos: a.totalPhotos,
    albumUrl: a.albumUrl,
    published: a.published,
  };
}

const galleries = (db: Database) =>
  createSluggedStore<Album>(db, {
    collection: "galleries",
    slug: { collection: "gallerySlugs", key: (a) => a.slug },
    fromDoc: toAlbum,
    snapshot: albumSnapshot,
    fixed: () => ({}),
  });

export function createSqlGalleryStore(db: Database) {
  const store = galleries(db);

  return {
    async listForAdmin(limit = 500): Promise<Album[]> {
      const snapshot = await store.docs.orderBy("updatedAt", "desc").limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((a) => a.deletedAt === null);
    },
    get: store.get,
    write: store.write,
  };
}

export type SqlGalleryStore = ReturnType<typeof createSqlGalleryStore>;

export function createSqlGalleryReader(db: Database) {
  const store = galleries(db);
  const published = async (query: Query) =>
    (await query.get()).docs
      .map((doc) => store.read(doc.id, doc.data()))
      .filter((a) => a.deletedAt === null)
      .map(toPublicAlbum);

  return {
    listPublished: (limit = 300): Promise<PublicAlbum[]> =>
      published(
        store.docs.where("published", "==", true).orderBy("updatedAt", "desc").limit(limit),
      ),

    async findPublishedBySlug(slug: string): Promise<PublicAlbum | null> {
      const album = await store.findBySlugKey(slug);
      return album?.published ? toPublicAlbum(album) : null;
    },

    async findPublishedByEvent(eventId: string): Promise<PublicAlbum | null> {
      const [album] = await published(
        store.docs.where("eventId", "==", eventId).where("published", "==", true).limit(1),
      );
      return album ?? null;
    },
  };
}

export type SqlGalleryReader = ReturnType<typeof createSqlGalleryReader>;
