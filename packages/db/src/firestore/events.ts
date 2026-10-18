import type { Firestore } from "firebase-admin/firestore";
import type { Snapshot } from "@website/audit";
import {
  isRegistrationOpen,
  nextRegistrationStatus,
  registrationId,
  toPublicEvent,
  type EventEntity,
  type EventImage,
  type EventType,
  type PublicEvent,
  type RegistrationStatus,
  type ScheduleRow,
  type Speaker,
  type Sponsor,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { getDocumentsByIds } from "./batch";
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
    slug: { collection: "eventSlugs", key: (e) => e.slug },
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

/** Published events for the website (role web_ro), newest first, as public DTOs. */
export function createFirestoreEventReader(db: Firestore) {
  const store = createFirestoreEventStore(db);
  return {
    async listPublished(limit = 300): Promise<PublicEvent[]> {
      const snapshot = await db
        .collection("events")
        .where("published", "==", true)
        .orderBy("startsAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => toEvent(doc.id, doc.data()))
        .filter((e) => e.deletedAt === null)
        .map(toPublicEvent);
    },

    async findPublishedBySlug(slug: string): Promise<PublicEvent | null> {
      const event = await store.findBySlug(slug);
      return event?.published ? toPublicEvent(event) : null;
    },
  };
}

export type FirestoreEventReader = ReturnType<typeof createFirestoreEventReader>;

/**
 * Internal registrations: `eventRegistrations/{eventId}_{uid}` (one per member and event) and
 * `eventCounters/{eventId}` { confirmed, waitlisted }, both written in the same transaction so
 * the capacity holds under concurrent sign-ups. No personal data is copied here.
 */
export function createFirestoreRegistrationStore(db: Firestore) {
  const registrationsRef = db.collection("eventRegistrations");
  return {
    register(
      eventId: string,
      userId: string,
      now: Date,
    ): Promise<{ status: RegistrationStatus; created: boolean }> {
      return db.runTransaction(async (tx) => {
        const eventSnap = await tx.get(db.collection("events").doc(safeId.parse(eventId)));
        const event = eventSnap.exists ? toEvent(eventSnap.id, eventSnap.data()!) : null;
        if (!event || !isRegistrationOpen(event, now)) {
          throw new RuleViolationError("Registration is closed.");
        }
        const ref = registrationsRef.doc(safeId.parse(registrationId(eventId, userId)));
        const existing = await tx.get(ref);
        if (existing.exists) {
          return { status: existing.get("status") as RegistrationStatus, created: false };
        }
        const counterRef = db.collection("eventCounters").doc(eventId);
        const counter = await tx.get(counterRef);
        const confirmed = (counter.get("confirmed") as number | undefined) ?? 0;
        const waitlisted = (counter.get("waitlisted") as number | undefined) ?? 0;
        const status = nextRegistrationStatus(event, confirmed);
        tx.set(ref, { eventId, userId, status, createdAt: now, updatedAt: now });
        tx.set(
          counterRef,
          status === "confirmed"
            ? { confirmed: confirmed + 1, waitlisted }
            : { confirmed, waitlisted: waitlisted + 1 },
        );
        return { status, created: true };
      });
    },

    /** A member's own registrations with their (live) events, newest event first. */
    async listByUser(
      userId: string,
    ): Promise<Array<{ status: RegistrationStatus; event: PublicEvent }>> {
      const snapshot = await registrationsRef.where("userId", "==", userId).get();
      const rows = snapshot.docs.map((doc) => ({
        eventId: doc.get("eventId") as string,
        status: doc.get("status") as RegistrationStatus,
      }));
      const events = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "events",
        rows.map((r) => r.eventId),
      );
      return rows
        .flatMap((r) => {
          const data = events.get(r.eventId);
          const event = data ? toEvent(r.eventId, data) : null;
          return event && event.deletedAt === null
            ? [{ status: r.status, event: toPublicEvent(event) }]
            : [];
        })
        .sort((a, b) => b.event.startsAt.getTime() - a.event.startsAt.getTime());
    },
  };
}

export type FirestoreRegistrationStore = ReturnType<typeof createFirestoreRegistrationStore>;
