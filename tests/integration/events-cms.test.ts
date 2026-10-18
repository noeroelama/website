import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreEventStore, eventSnapshot } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createEventActions } from "../../apps/admin/src/server/events";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreEventStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "editor-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const editor = staff(["events.edit"]);
const reader = staff(["events.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const image = {
  url: "https://storage.example/events/banners/a.webp",
  thumbUrl: "https://storage.example/events/banners/a_thumb.webp",
  path: "events/banners/a.webp",
  thumbPath: "events/banners/a_thumb.webp",
  width: 2400,
  height: 1200,
};
const event = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-11-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: null,
  location: "Tokyo",
  description: "Simposium tahunan.",
  bannerImage: image,
  registrationUrl: "",
  slug: "",
  schedule: [{ time: "09:00", title: "Pembukaan", description: "" }],
  speakers: [
    { name: "Dr. Sari", description: "Peneliti", photo: image },
    { name: "Budi", description: "", photo: null },
  ],
  sponsors: [
    { logo: null, caption: "Sponsor A" },
    { logo: image, caption: "Sponsor B" },
  ],
};

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestoreEventStore>;
const actions = () =>
  createEventActions({
    events: store,
    now: () => now,
    uuid: () => "3f2a9c1e-0000-4000-8000-000000000000",
  });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(() => {
  fake = fakeFirestore();
  store = createFirestoreEventStore(fake.db as unknown as Db);
});

describe("Events CMS: save, publish, delete", () => {
  it("saves a draft with a random slug, sponsor order numbers and a CREATE entry", async () => {
    expect(
      await actions().save(...as(reader))({ ...event, version: null, publish: false }),
    ).toEqual({ ok: false, error: "forbidden" });
    const result = await actions().save(...as(editor))({ ...event, version: null, publish: false });
    expect(result).toMatchObject({ ok: true, data: { slug: "event-3f2a9c1e", version: 1 } });
    const saved = await store.get(result.ok ? result.data.id : "");
    expect(saved).toMatchObject({
      published: false,
      registrationUrl: null,
      type: "seminar",
      chapterId: null,
    });
    expect(saved?.sponsors.map((s) => [s.order, s.caption])).toEqual([
      [1, "Sponsor A"],
      [2, "Sponsor B"],
    ]);
    expect(auditEntries()).toEqual([
      expect.objectContaining({ action: "CREATE", module: "events", resourceType: "event" }),
    ]);
  });

  it("refuses a deadline after the event date and a URL already in use", async () => {
    expect(
      await actions().save(...as(editor))({
        ...event,
        registrationClosesAt: "2026-11-21T00:00:00.000Z",
        version: null,
        publish: false,
      }),
    ).toMatchObject({
      error: "invalid_input",
      fields: { registrationClosesAt: "The deadline must be on or before the event date." },
    });
    await actions().save(...as(editor))({
      ...event,
      slug: "simposium",
      version: null,
      publish: true,
    });
    expect(
      await actions().save(...as(editor))({
        ...event,
        slug: "simposium",
        version: null,
        publish: true,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already used")] });
  });

  it("publish now, edit (version check), unpublish, then soft delete keeps registrations", async () => {
    const created = await actions().save(...as(editor))({
      ...event,
      slug: "simposium",
      version: null,
      publish: true,
    });
    const id = created.ok ? created.data.id : "";
    expect(await store.findBySlug("simposium")).toMatchObject({ published: true });
    expect(
      await actions().save(...as(editor))({ ...event, id, version: 9, publish: true }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await actions().save(...as(editor))({
        ...event,
        id,
        slug: "simposium-2026",
        version: 1,
        publish: true,
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: false });
    expect(
      await actions().setPublished(...as(editor))({ id, version: 2, published: false }),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(
      await actions().setPublished(...as(editor))({ id, version: 3, published: true }),
    ).toMatchObject({ ok: true });
    fake.docs.set(`eventRegistrations/${id}_u1`, {
      eventId: id,
      userId: "u1",
      status: "confirmed",
    });
    expect(await actions().remove(...as(editor))({ id, version: 4 })).toMatchObject({ ok: true });
    expect(await store.findBySlug("simposium-2026")).toBeNull();
    expect(await store.listForAdmin()).toEqual([]);
    expect(fake.docs.get(`eventRegistrations/${id}_u1`)).toMatchObject({ status: "confirmed" });
    expect(auditEntries().map((e) => e["action"])).toEqual([
      "CREATE",
      "UPDATE",
      "UNPUBLISH",
      "PUBLISH",
      "DELETE",
    ]);
    expect(auditEntries().at(-1)).toMatchObject({ after: null, revertible: true });
    expect(REVERTIBLE_COLLECTIONS["event"]).toBe("events");
  });

  it("publishing a saved draft from the form is a PUBLISH; the admin list is newest first", async () => {
    const first = await actions().save(...as(editor))({
      ...event,
      slug: "a",
      version: null,
      publish: false,
    });
    const id = first.ok ? first.data.id : "";
    await actions().save(...as(editor))({ ...event, slug: "a", id, version: 1, publish: true });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "PUBLISH"]);
    expect((await store.listForAdmin()).map((e) => e.id)).toEqual([id]);
    expect(await store.get("bad/id")).toBeNull();
    // Events imported from PPIDK (block J) may have no banner.
    const saved = await store.get(id);
    expect(eventSnapshot({ ...saved!, bannerImage: null })["bannerImage"]).toBeNull();
  });
});
