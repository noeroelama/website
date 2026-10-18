import { beforeEach, describe, expect, it } from "vitest";
import {
  createFirestoreEventStore,
  createFirestoreGalleryReader,
  createFirestoreGalleryStore,
} from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createEventActions } from "../../apps/admin/src/server/events";
import { createGalleryActions } from "../../apps/admin/src/server/gallery";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreGalleryStore>[0];
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
const editor = staff(["gallery.edit", "events.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const image = {
  url: "https://storage.example/galleries/a.webp",
  thumbUrl: "https://storage.example/galleries/a_thumb.webp",
  path: "galleries/a.webp",
  thumbPath: "galleries/a_thumb.webp",
  width: 2400,
  height: 1600,
};
const eventInput = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-09-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: null,
  location: "Tokyo",
  description: "D",
  bannerImage: image,
  registrationUrl: "",
  slug: "simposium",
  schedule: [],
  speakers: [],
  sponsors: [],
};

let fake: ReturnType<typeof fakeFirestore>;
let albums: ReturnType<typeof createFirestoreGalleryStore>;
let events: ReturnType<typeof createFirestoreEventStore>;
const gallery = () => createGalleryActions({ albums, events, now: () => now });
const eventActions = () => createEventActions({ events, now: () => now, uuid: () => "u" });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const createEvent = async (publish: boolean, slug = "simposium") => {
  const result = await eventActions().save(...as(editor))({
    ...eventInput,
    slug,
    version: null,
    publish,
  });
  return result.ok ? result.data.id : "";
};

beforeEach(() => {
  fake = fakeFirestore();
  albums = createFirestoreGalleryStore(fake.db as unknown as Db);
  events = createFirestoreEventStore(fake.db as unknown as Db);
});

describe("Gallery CMS", () => {
  it("an album needs a published event; its URL defaults to the event's", async () => {
    const draftEvent = await createEvent(false, "draft-event");
    const album = { images: [image], totalPhotos: 150, albumUrl: "https://photos.app.goo.gl/x" };
    expect(
      await gallery().save(...as(editor))({
        ...album,
        eventId: draftEvent,
        slug: "",
        version: null,
        publish: false,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("published event")] });
    expect(
      await gallery().save(...as(editor))({
        ...album,
        eventId: "missing",
        slug: "",
        version: null,
        publish: false,
      }),
    ).toMatchObject({ error: "refused" });
    const eventId = await createEvent(true);
    const saved = await gallery().save(...as(editor))({
      ...album,
      eventId,
      slug: "",
      version: null,
      publish: true,
    });
    expect(saved).toMatchObject({ ok: true, data: { slug: "simposium", version: 1 } });
    expect(await albums.get(saved.ok ? saved.data.id : "")).toMatchObject({
      eventTitle: "Simposium 2026",
      published: true,
    });
    expect(
      await gallery().save(...as(editor))({
        ...album,
        images: Array(11).fill(image),
        eventId,
        slug: "",
        version: null,
        publish: true,
      }),
    ).toMatchObject({ error: "invalid_input" });
  });

  it("edit, unpublish, publish, then soft delete; the web reader shows published albums only", async () => {
    const eventId = await createEvent(true);
    const created = await gallery().save(...as(editor))({
      images: [image],
      totalPhotos: null,
      albumUrl: "https://photos.app.goo.gl/x",
      eventId,
      slug: "",
      version: null,
      publish: false,
    });
    const id = created.ok ? created.data.id : "";
    const reader = createFirestoreGalleryReader(fake.db as unknown as Db);
    expect(await reader.listPublished()).toEqual([]);
    expect(await reader.findPublishedBySlug("simposium")).toBeNull();
    await gallery().save(...as(editor))({
      images: [image, image],
      totalPhotos: null,
      albumUrl: "https://photos.app.goo.gl/x",
      eventId,
      slug: "simposium-2026",
      id,
      version: 1,
      publish: true,
    });
    expect(auditEntries().at(-1)).toMatchObject({
      action: "PUBLISH",
      module: "gallery",
      revertible: false,
    });
    expect(await reader.findPublishedBySlug("simposium-2026")).toMatchObject({ photoCount: 2 });
    expect(await reader.findPublishedByEvent(eventId)).toMatchObject({ slug: "simposium-2026" });
    expect(await reader.findPublishedByEvent("other")).toBeNull();
    expect((await reader.listPublished()).map((a) => a.slug)).toEqual(["simposium-2026"]);
    await gallery().save(...as(editor))({
      images: [image],
      totalPhotos: 5,
      albumUrl: "https://photos.app.goo.gl/x",
      eventId,
      slug: "simposium-2026",
      id,
      version: 2,
      publish: true,
    });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: true });
    await gallery().setPublished(...as(editor))({ id, version: 3, published: false });
    await gallery().setPublished(...as(editor))({ id, version: 4, published: true });
    expect(await gallery().remove(...as(editor))({ id, version: 5 })).toMatchObject({ ok: true });
    expect(await albums.listForAdmin()).toEqual([]);
    expect(await reader.listPublished()).toEqual([]);
    expect(
      auditEntries()
        .slice(-3)
        .map((e) => e["action"]),
    ).toEqual(["UNPUBLISH", "PUBLISH", "DELETE"]);
    expect(REVERTIBLE_COLLECTIONS["album"]).toBe("galleries");
  });
});
