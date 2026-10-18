import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFirestoreCampaignStore,
  createFirestoreSubscriberReader,
  createFirestoreSubscriberStore,
} from "@website/db/firestore";
import type { Message } from "@website/domain/messaging";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createNewsletterActions } from "../../apps/admin/src/server/newsletter";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreCampaignStore>[0];
let now = new Date("2026-10-18T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const editor = staff(["newsletter.edit"]);
const sender = staff(["newsletter.edit", "newsletter.send", "newsletter.export"]);
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeFirestore>;
let sentKeys: Set<string>;
let mails: Array<{ message: Message; key: string }>;
let exports: Array<[string, number]>;
let crashAfter: number | null;
const actions = () => {
  const db = fake.db as unknown as Db;
  return createNewsletterActions({
    campaigns: createFirestoreCampaignStore(db),
    subscribers: createFirestoreSubscriberReader(db),
    // Like the messenger: a key is claimed once; a repeat answers "duplicate".
    send: vi.fn((message: Message, key: string) => {
      if (crashAfter !== null && mails.length >= crashAfter) throw new Error("crash");
      if (sentKeys.has(key)) return Promise.resolve("duplicate" as const);
      sentKeys.add(key);
      mails.push({ message, key });
      return Promise.resolve("sent" as const);
    }),
    unsubscribeUrl: (id) => `https://ppiasiania.id/newsletter/unsubscribe?t=signed-${id}`,
    staffEmail: (uid) => Promise.resolve(uid === "staff-1" ? "staff@example.org" : null),
    logExport: (actor, rows) => exports.push([actor, rows]),
    now: () => now,
    batchSize: 2,
  });
};
const subscribe = async (n: number, status: "confirmed" | "pending" | "unsubscribed") => {
  const store = createFirestoreSubscriberStore(fake.db as unknown as Db);
  const id = `${status[0]}${String(n).padStart(63, "0")}`;
  await store.startOptIn(id, `user${n}@example.org`, "hash", new Date(now.getTime() + 1e9), now);
  if (status === "confirmed") await store.confirm(id, "hash", now);
  if (status === "unsubscribed") await store.unsubscribe(id, now);
};
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const draft = async () => {
  const result = await actions().save(...as(editor))({
    subject: "Edisi Oktober",
    body: "<p>Halo <script>x()</script></p>",
    segment: "all",
    version: null,
  });
  return result.ok ? result.data.id : "";
};

beforeEach(() => {
  now = new Date("2026-10-18T05:00:00Z");
  fake = fakeFirestore();
  sentKeys = new Set();
  mails = [];
  exports = [];
  crashAfter = null;
});

describe("newsletter campaigns", () => {
  it("sending needs newsletter.send; only confirmed subscribers get it, in batches, once", async () => {
    for (let n = 1; n <= 3; n++) await subscribe(n, "confirmed");
    await subscribe(4, "pending");
    await subscribe(5, "unsubscribed");
    const id = await draft();
    expect(await actions().send(...as(editor))({ id, version: 1, sendAt: null })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await actions().send(...as(sender))({ id, version: 1, sendAt: null })).toMatchObject({
      ok: true,
      data: { status: "sending" },
    });
    expect(auditEntries().at(-1)).toMatchObject({ action: "SEND", revertible: false });

    expect(await actions().runBatch()).toEqual({ campaign: id, processed: 2 });
    expect(await actions().runBatch()).toEqual({ campaign: id, processed: 1 });
    expect(await actions().runBatch()).toEqual({ processed: 0 });
    expect(mails.map((m) => m.message.to).sort()).toEqual([
      "user1@example.org",
      "user2@example.org",
      "user3@example.org",
    ]);
    expect(mails[0]?.key).toMatch(new RegExp(`^newsletter:${id}:c0+1$`));
    expect(mails[0]?.message.html).not.toContain("<script");
    expect(mails[0]?.message.html).toContain("unsubscribe?t=signed-");
    expect(mails[0]?.message.text).toContain("Unsubscribe: https://");
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "sent", sentCount: 3 });
    // A sent campaign can no longer be changed, sent or deleted.
    expect(await actions().remove(...as(editor))({ id, version: 2 })).toMatchObject({
      error: "refused",
    });
  });

  it("a crash mid-batch repeats the batch without mailing anyone twice", async () => {
    for (let n = 1; n <= 2; n++) await subscribe(n, "confirmed");
    const id = await draft();
    await actions().send(...as(sender))({ id, version: 1, sendAt: null });
    crashAfter = 1;
    await expect(actions().runBatch()).rejects.toThrow("crash");
    crashAfter = null;
    expect(await actions().runBatch()).toMatchObject({ processed: 2 });
    expect(mails).toHaveLength(2);
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ sentCount: 1 });
  });

  it("schedules for later; the cron starts it when the time has come", async () => {
    await subscribe(1, "confirmed");
    const id = await draft();
    await actions().send(...as(sender))({
      id,
      version: 1,
      sendAt: "2026-10-19T00:00:00.000Z",
    });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "scheduled" });
    expect(await actions().runBatch()).toEqual({ processed: 0 });
    now = new Date("2026-10-19T00:00:00Z");
    expect(await actions().runBatch()).toMatchObject({ processed: 1 });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "sent" });
  });

  it("drafts: edit, refuse an empty body, delete; Send Test goes to the staff member only", async () => {
    const id = await draft();
    expect(
      await actions().save(...as(editor))({
        id,
        subject: "Edisi Oktober (revisi)",
        body: "<p></p>",
        segment: "all",
        version: 1,
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await actions().send(...as(sender))({ id, version: 2, sendAt: null })).toMatchObject({
      error: "refused",
      issues: ["Write the content first."],
    });
    expect(await actions().sendTest(...as(editor))({ id })).toMatchObject({ ok: true });
    expect(mails.at(-1)?.message).toMatchObject({
      to: "staff@example.org",
      subject: "[TEST] Edisi Oktober (revisi)",
    });
    expect(
      await actions().sendTest(...as(staff(["newsletter.edit"])))({ id: "missing" }),
    ).toMatchObject({ error: "refused", issues: ["Save the campaign first."] });
    const nobody: Principal = { ...editor, userId: "staff-2" };
    expect(await actions().sendTest(...as(nobody))({ id })).toMatchObject({
      error: "refused",
      issues: ["Your account has no e-mail address."],
    });
    expect(await actions().remove(...as(editor))({ id, version: 2 })).toMatchObject({ ok: true });
    expect(await actions().sendTest(...as(editor))({ id })).toMatchObject({ error: "refused" });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "UPDATE", "DELETE"]);
  });

  it("the oldest due campaign goes first; the admin list shows live campaigns, newest first", async () => {
    await subscribe(1, "confirmed");
    const first = await draft();
    await actions().send(...as(sender))({ id: first, version: 1, sendAt: null });
    now = new Date("2026-10-18T06:00:00Z");
    const second = await draft();
    await actions().send(...as(sender))({ id: second, version: 1, sendAt: null });
    const store = createFirestoreCampaignStore(fake.db as unknown as Db);
    expect((await store.listForAdmin()).map((c) => c.id)).toEqual([second, first]);
    expect(await actions().runBatch()).toMatchObject({ campaign: first });
    const third = await draft();
    await actions().remove(...as(editor))({ id: third, version: 1 });
    expect(await store.listForAdmin()).toHaveLength(2);
  });

  it("a campaign with no confirmed subscribers finishes at once", async () => {
    const id = await draft();
    await actions().send(...as(sender))({ id, version: 1, sendAt: null });
    expect(await actions().runBatch()).toMatchObject({ processed: 0, campaign: id });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "sent", cursor: null });
  });

  it("export needs newsletter.export and is logged", async () => {
    await subscribe(1, "confirmed");
    await subscribe(2, "pending");
    expect(await actions().exportSubscribers(...as(editor))({})).toEqual({
      ok: false,
      error: "forbidden",
    });
    const result = await actions().exportSubscribers(...as(sender))({});
    expect(result.ok && result.data.csv.split("\r\n")).toEqual([
      "email,status,subscribed,confirmed",
      expect.stringContaining('"user1@example.org","confirmed"'),
      expect.stringContaining('"user2@example.org","pending"'),
    ]);
    expect(exports).toEqual([["staff-1", 2]]);
  });
});
