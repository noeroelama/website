import type { Firestore } from "firebase-admin/firestore";
import type { Snapshot } from "@website/audit";
import type {
  EventEntity,
  EventImage,
  EventType,
  ScheduleRow,
  Speaker,
  Sponsor,
} from "@website/domain/events";
import { createSluggedStore, toDate } from "./slugged";

export type EventFields = Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt">;

function toEvent(id: string, data: Record<string, unknown>): EventEntity {
  return {
    id,
    slug: data["slug"] as string,
    title: data["title"] as string,
    summary: data["summary"] as string | null,
    startsAt: toDate(data["startsAt"]) as Date,
    endsAt: toDate(data["endsAt"]),
    timezone: data["timezone"] as string,
    location: data["location"] as string | null,
    chapterId: data["chapterId"] as string | null,
    published: data["published"] as boolean,
    capacity: data["capacity"] as number | null,
    registrationClosesAt: toDate(data["registrationClosesAt"]),
    type: data["type"] as EventType,
    description: data["description"] as string,
    bannerImage: data["bannerImage"] as EventImage | null,
    registrationUrl: data["registrationUrl"] as string | null,
    schedule: data["schedule"] as ScheduleRow[],
    speakers: data["speakers"] as Speaker[],
    sponsors: data["sponsors"] as Sponsor[],
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Audit snapshot = the editable fields; dates as ISO strings (also stored that way). */
export function eventSnapshot(e: EventFields): Snapshot {
  return {
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    timezone: e.timezone,
    location: e.location,
    published: e.published,
    capacity: e.capacity,
    registrationClosesAt: iso(e.registrationClosesAt),
    type: e.type,
    description: e.description,
    bannerImage: e.bannerImage ? { ...e.bannerImage } : null,
    registrationUrl: e.registrationUrl,
    schedule: e.schedule.map((row) => ({ ...row })),
    speakers: e.speakers.map((s) => ({ ...s, photo: s.photo ? { ...s.photo } : null })),
    sponsors: e.sponsors.map((s) => ({ ...s, logo: s.logo ? { ...s.logo } : null })),
  };
}

/**
 * `events/{id}` + `eventSlugs/{slug}`. Registrations live in `eventRegistrations` and are never
 * touched here: a soft-deleted event keeps its registrant list.
 */
export function createFirestoreEventStore(db: Firestore) {
  const store = createSluggedStore<EventEntity>(db, {
    collection: "events",
    slugCollection: "eventSlugs",
    slugKey: (e) => e.slug,
    fromDoc: toEvent,
    snapshot: eventSnapshot,
    fixed: (e) => ({ chapterId: e.chapterId }),
  });

  return {
    /** Admin list: newest change first, trash excluded. */
    async listForAdmin(limit = 500): Promise<EventEntity[]> {
      const snapshot = await store.docs.orderBy("updatedAt", "desc").limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((e) => e.deletedAt === null);
    },
    get: store.get,
    /** Live event by URL slug (published or not; callers decide what to show). */
    findBySlug: (slug: string) => store.findBySlugKey(slug),
    write: store.write,
  };
}

export type FirestoreEventStore = ReturnType<typeof createFirestoreEventStore>;
