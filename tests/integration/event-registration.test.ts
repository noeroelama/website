import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import {
  createFirestoreEventReader,
  createFirestoreEventStore,
  createFirestoreRegistrationStore,
} from "@website/db/firestore";
import type { EventEntity } from "@website/domain/events";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreEventStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
let auditSeq = 0;
/** Minimal audit entry: these tests are about reading and registering, not auditing. */
const auditStub = (): AuditEvent => ({
  id: `audit-${++auditSeq}`,
  occurredAt: now,
  actor: { type: "system", id: "test" },
  action: "CREATE",
  resourceType: "event",
  resourceId: "x",
  operationId: "op",
  before: null,
  after: null,
  versionBefore: null,
  versionAfter: 1,
  revertible: false,
  revertOf: null,
  request: { requestId: "req-123456" },
  prevHash: null,
  hash: null,
});

let fake: ReturnType<typeof fakeFirestore>;
let events: ReturnType<typeof createFirestoreEventStore>;
let registrations: ReturnType<typeof createFirestoreRegistrationStore>;

const base: Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt"> = {
  slug: "simposium",
  title: "Simposium",
  summary: null,
  startsAt: new Date("2026-11-20T02:00:00Z"),
  endsAt: null,
  timezone: "Asia/Tokyo",
  location: "Tokyo",
  chapterId: null,
  published: true,
  capacity: null,
  registrationClosesAt: new Date("2026-11-19T00:00:00Z"),
  type: "seminar",
  description: "D",
  bannerImage: null,
  registrationUrl: null,
  schedule: [],
  speakers: [],
  sponsors: [],
  deletedAt: null,
};
const create = (fields: Partial<typeof base>) =>
  events.write(null, null, () => ({ ...base, ...fields }), auditStub, now);

beforeEach(() => {
  fake = fakeFirestore();
  events = createFirestoreEventStore(fake.db as unknown as Db);
  registrations = createFirestoreRegistrationStore(fake.db as unknown as Db);
});

describe("public event reader (web)", () => {
  it("lists published, live events newest first and finds one by slug", async () => {
    await create({ slug: "old", startsAt: new Date("2026-01-01T00:00:00Z") });
    await create({ slug: "new", startsAt: new Date("2026-12-01T00:00:00Z") });
    await create({ slug: "draft", published: false });
    const gone = await create({ slug: "gone" });
    await events.write(gone.id, 1, (c) => ({ ...c!, deletedAt: now }), auditStub, now);
    const reader = createFirestoreEventReader(fake.db as unknown as Db);
    expect((await reader.listPublished()).map((e) => e.slug)).toEqual(["new", "old"]);
    expect(await reader.findPublishedBySlug("draft")).toBeNull();
    expect(await reader.findPublishedBySlug("gone")).toBeNull();
    expect(await reader.findPublishedBySlug("new")).toMatchObject({ slug: "new" });
    expect(await reader.findPublishedBySlug("missing")).toBeNull();
  });
});

describe("event registration (internal)", () => {
  it("confirms while seats remain, then waitlists; a second registration changes nothing", async () => {
    const event = await create({ capacity: 1 });
    expect(await registrations.register(event.id, "u1", now)).toEqual({
      status: "confirmed",
      created: true,
    });
    expect(await registrations.register(event.id, "u1", now)).toEqual({
      status: "confirmed",
      created: false,
    });
    expect(await registrations.register(event.id, "u2", now)).toEqual({
      status: "waitlisted",
      created: true,
    });
    expect(fake.docs.get(`eventCounters/${event.id}`)).toMatchObject({
      confirmed: 1,
      waitlisted: 1,
    });
    expect(fake.docs.get(`eventRegistrations/${event.id}_u1`)).toMatchObject({
      eventId: event.id,
      userId: "u1",
      status: "confirmed",
    });
  });

  it("respects capacity when many register at the same time", async () => {
    const event = await create({ capacity: 2 });
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((uid) => registrations.register(event.id, uid, now)),
    );
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(2);
    expect(results.filter((r) => r.status === "waitlisted")).toHaveLength(3);
  });

  it("refuses after the deadline (boundary: closes exactly at the deadline) and for hidden events", async () => {
    const event = await create({});
    const deadline = base.registrationClosesAt as Date;
    expect(
      await registrations.register(event.id, "u1", new Date(deadline.getTime() - 1)),
    ).toMatchObject({ created: true });
    await expect(registrations.register(event.id, "u2", deadline)).rejects.toThrow(
      "Registration is closed.",
    );
    const draft = await create({ slug: "draft", published: false });
    await expect(registrations.register(draft.id, "u1", now)).rejects.toThrow(
      "Registration is closed.",
    );
    await expect(registrations.register("missing", "u1", now)).rejects.toThrow(
      "Registration is closed.",
    );
  });

  it("lists a member's registrations with their events", async () => {
    const event = await create({});
    await registrations.register(event.id, "u1", now);
    const [first] = await registrations.listByUser("u1");
    expect(first?.status).toBe("confirmed");
    expect(first?.event.slug).toBe("simposium");
    expect(await registrations.listByUser("nobody")).toEqual([]);
    // Deleted (or missing) events drop out of the member's list; newest event first.
    const later = await create({ slug: "later", startsAt: new Date("2026-12-24T00:00:00Z") });
    const gone = await create({ slug: "gone" });
    await registrations.register(later.id, "u1", now);
    await registrations.register(gone.id, "u1", now);
    await events.write(gone.id, 1, (c) => ({ ...c!, deletedAt: now }), auditStub, now);
    fake.docs.set("eventRegistrations/ghost_u1", {
      eventId: "ghost",
      userId: "u1",
      status: "confirmed",
    });
    expect((await registrations.listByUser("u1")).map((r) => r.event.slug)).toEqual([
      "later",
      "simposium",
    ]);
  });
});
