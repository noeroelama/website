import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSqlCampaignStore,
  createSqlCampaignWebStore,
  createSqlSubscriberReader,
  createSqlSubscriberStore,
} from "@website/db/sql";
import type { Message } from "@website/domain/messaging";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createNewsletterActions } from "../../apps/admin/src/server/newsletter";
import { fakeDb } from "../support/fake-db";
import { revertEntry } from "../support/revert";

type Db = Parameters<typeof createSqlCampaignStore>[0];
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

let fake: ReturnType<typeof fakeDb>;
let sentKeys: Set<string>;
let mails: Array<{ message: Message; key: string }>;
let exports: Array<[string, number]>;
let crashAfter: number | null;
const actions = () => {
  const db = fake.db as unknown as Db;
  return createNewsletterActions({
    campaigns: createSqlCampaignStore(db),
    subscribers: {
      ...createSqlSubscriberReader(db),
      ...createSqlSubscriberStore(db),
    },
    send: vi.fn((message: Message, key: string) => {
      if (crashAfter !== null && mails.length >= crashAfter) throw new Error("crash");
      if (sentKeys.has(key)) return Promise.resolve("duplicate" as const);
      sentKeys.add(key);
      mails.push({ message, key });
      return Promise.resolve("sent" as const);
    }),
    unsubscribeUrl: (id) => `https://ppiasiania.id/newsletter/unsubscribe?t=signed-${id}`,
    openUrl: (c, s) => `https://ppiasiania.id/newsletter/o?t=open-${c}-${s}`,
    clickUrl: (c, s, url) => `https://ppiasiania.id/newsletter/c?t=click-${c}-${s}-${url}`,
    subscriberId: (email) => `h${email.replace(/[^a-z0-9]/g, "")}`.padEnd(64, "0"),
    newToken: () => "token-1",
    confirmUrl: (id, token) => `https://ppiasiania.id/newsletter/confirm?s=${id}&t=${token}`,
    chapters: () => Promise.resolve([{ id: "jp", name: "PPI Jepang" }]),
    staffEmail: (uid) => Promise.resolve(uid === "staff-1" ? "staff@example.org" : null),
    logExport: (actor, rows) => exports.push([actor, rows]),
    now: () => now,
    batchSize: 2,
  });
};
const subscribe = async (n: number, status: "confirmed" | "pending" | "unsubscribed") => {
  const store = createSqlSubscriberStore(fake.db as unknown as Db);
  const id = `${status[0]}${String(n).padStart(63, "0")}`;
  await store.startOptIn(id, `user${n}@example.org`, "hash", new Date(now.getTime() + 1e9), now);
  if (status === "confirmed") await store.confirm(id, "hash", now);
  if (status === "unsubscribed") await store.unsubscribe(id, now);
};
const later = () => new Date(now.getTime() + 1e9);
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
  fake = fakeDb();
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
    expect(
      await actions().save(...as(editor))({
        id,
        subject: "Edisi Oktober",
        body: "<p>x</p>",
        segment: "all",
        version: 2,
      }),
    ).toMatchObject({ error: "refused" });
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

  it("a schedule in the past is refused instead of mailing everyone at once", async () => {
    await subscribe(1, "confirmed");
    const id = await draft();
    expect(
      await actions().send(...as(sender))({ id, version: 1, sendAt: "2026-10-17T05:00:00.000Z" }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "draft" });
  });

  it("an editor without newsletter.send who edits a scheduled campaign puts it back to draft", async () => {
    const id = await draft();
    await actions().send(...as(sender))({ id, version: 1, sendAt: "2026-10-19T00:00:00.000Z" });
    const edit = { subject: "Diubah", body: "<p>Lain</p>", segment: "all" as const, id };
    expect(await actions().save(...as(editor))({ ...edit, version: 2 })).toMatchObject({
      ok: true,
    });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "draft", sendAt: null });
    await actions().send(...as(sender))({ id, version: 3, sendAt: "2026-10-19T00:00:00.000Z" });
    expect(await actions().save(...as(sender))({ ...edit, version: 4 })).toMatchObject({
      ok: true,
    });
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "scheduled" });
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
    const store = createSqlCampaignStore(fake.db as unknown as Db);
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
      "email,name,status,subscribed,confirmed",
      expect.stringContaining('"user1@example.org","","confirmed"'),
      expect.stringContaining('"user2@example.org","","pending"'),
    ]);
    expect(exports).toEqual([["staff-1", 2]]);

    const [key, doc] = [...fake.docs.entries()].find(
      ([p, d]) => p.startsWith("subscribers/") && d["email"] === "user1@example.org",
    ) as [string, Record<string, unknown>];
    fake.docs.set(key, { ...doc, name: '=HYPERLINK("https://evil.example","x")' });
    const guarded = await actions().exportSubscribers(...as(sender))({});
    expect(guarded.ok && guarded.data.csv).toContain(`"'=HYPERLINK(""https://evil.example""`);
  });

  it("every campaign e-mail has an open pixel and tracked links; Send Test has neither", async () => {
    await subscribe(1, "confirmed");
    const saved = await actions().save(...as(editor))({
      subject: "Links",
      body: '<p><a href="https://ppi.id/a">a</a></p>',
      segment: "all",
      version: null,
    });
    const id = saved.ok ? saved.data.id : "";
    await actions().sendTest(...as(editor))({ id });
    expect(mails[0]?.message.html).toContain('href="https://ppi.id/a"');
    expect(mails[0]?.message.html).not.toContain("newsletter/o?");
    await actions().send(...as(sender))({ id, version: 1, sendAt: null });
    await actions().runBatch();
    const html = mails[1]?.message.html ?? "";
    expect(html).toContain(`newsletter/c?t=click-${id}-c`);
    expect(html).toContain("-https://ppi.id/a");
    expect(html).toMatch(
      new RegExp(`<img src="https://ppiasiania.id/newsletter/o\\?t=open-${id}-c0+1"`),
    );
    expect(html).toContain('href="https://ppiasiania.id/newsletter/unsubscribe?t=signed-');
  });

  it("sent campaigns can be deleted and the deletion reverted; a sending one cannot", async () => {
    await subscribe(1, "confirmed");
    await subscribe(2, "confirmed");
    await subscribe(3, "confirmed");
    const id = await draft();
    await actions().send(...as(sender))({ id, version: 1, sendAt: null });
    await actions().runBatch();
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ status: "sending" });
    expect(await actions().remove(...as(editor))({ id, version: 2 })).toMatchObject({
      error: "refused",
    });
    await actions().runBatch();
    expect(await actions().remove(...as(editor))({ id, version: 2 })).toMatchObject({ ok: true });
    const store = createSqlCampaignStore(fake.db as unknown as Db);
    expect(await store.listForAdmin()).toEqual([]);
    const entry = auditEntries().at(-1) as { id: string; action: string };
    expect(entry.action).toBe("DELETE");
    expect(await revertEntry(fake.db, entry.id, now)).toMatchObject({ ok: true });
    expect((await store.listForAdmin()).map((c) => c.id)).toEqual([id]);
  });

  it("Add New Subscriber: opt-in e-mail, pending with name and PPI, audited without the address", async () => {
    const add = (input: Record<string, unknown>, who = editor) =>
      actions().addSubscriber(...as(who))({ name: "", chapterId: null, ...input });
    expect(await add({ email: "sari@example.org" }, staff(["newsletter.read"]))).toMatchObject({
      error: "forbidden",
    });
    expect(await add({ email: "nope" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await add({ email: "sari@example.org", chapterId: "xx" })).toMatchObject({
      error: "refused",
      issues: ["Choose a PPI from the list."],
    });
    expect(
      await add({ email: " Sari@Example.org ", name: "Sari Wulandari", chapterId: "jp" }),
    ).toMatchObject({ ok: true, data: { outcome: "start" } });
    expect(mails).toHaveLength(1);
    expect(mails[0]?.message.to).toBe("sari@example.org");
    expect(mails[0]?.message.text).toContain("newsletter/confirm?s=hsariexampleorg");
    expect(mails[0]?.key).toMatch(/^newsletter:hsariexampleorg0+:optin:1$/);
    const list = await createSqlSubscriberReader(fake.db as unknown as Db).listForAdmin();
    expect(list).toEqual([
      expect.objectContaining({ status: "pending", name: "Sari Wulandari", chapterId: "jp" }),
    ]);
    const entry = auditEntries().at(-1);
    expect(entry).toMatchObject({
      action: "CREATE",
      resourceType: "subscriber",
      revertible: false,
    });
    expect(JSON.stringify(entry)).not.toContain("sari@example.org");
    expect(await add({ email: "sari@example.org" })).toMatchObject({
      ok: true,
      data: { outcome: "exists" },
    });
    const store = createSqlSubscriberStore(fake.db as unknown as Db);
    const gone = "hgoneexampleorg".padEnd(64, "0");
    await store.startOptIn(gone, "gone@example.org", "x", now, now);
    await store.unsubscribe(gone, now);
    expect(await add({ email: "gone@example.org" })).toMatchObject({
      ok: true,
      data: { outcome: "unsubscribed" },
    });
    expect(mails).toHaveLength(1);
  });

  it("Import CSV: new people get the opt-in e-mail; known, unsubscribed and bad rows are reported", async () => {
    await actions().addSubscriber(...as(editor))({
      email: "user1@example.org",
      name: "",
      chapterId: null,
    });
    const store = createSqlSubscriberStore(fake.db as unknown as Db);
    const gone = "hgoneexampleorg".padEnd(64, "0");
    await store.startOptIn(gone, "gone@example.org", "x", now, now);
    await store.unsubscribe(gone, now);
    const csv = [
      "email,name,ppi",
      "new@example.org,Budi,ppi jepang",
      "user1@example.org,,",
      "gone@example.org,,",
      "broken,,",
      "other@example.org,,PPI Mars",
    ].join("\n");
    expect(await actions().importSubscribers(...as(sender))({ csv })).toEqual({
      ok: true,
      data: { added: 2, existing: 1, unsubscribed: 1, invalid: [5] },
    });
    expect(mails.map((m) => m.message.to)).toEqual([
      "user1@example.org",
      "new@example.org",
      "other@example.org",
    ]);
    const rows = await createSqlSubscriberReader(fake.db as unknown as Db).listForAdmin();
    expect(rows.find((r) => r.email === "new@example.org")).toMatchObject({ chapterId: "jp" });
    expect(rows.find((r) => r.email === "other@example.org")).toMatchObject({ chapterId: null });
    expect(await actions().importSubscribers(...as(sender))({ csv: "name\nx" })).toMatchObject({
      error: "refused",
    });
  });

  it("deleting a subscriber hides and stops mailing them; revertible; a new sign-up brings them back", async () => {
    await subscribe(1, "confirmed");
    await subscribe(2, "confirmed");
    const id = `c${"1".padStart(63, "0")}`;
    expect(await actions().removeSubscriber(...as(editor))({ id })).toMatchObject({ ok: true });
    expect(await actions().removeSubscriber(...as(editor))({ id })).toMatchObject({
      error: "refused",
    });
    const reader = createSqlSubscriberReader(fake.db as unknown as Db);
    expect((await reader.listForAdmin()).map((r) => r.email)).toEqual(["user2@example.org"]);
    const campaign = await draft();
    await actions().send(...as(sender))({ id: campaign, version: 1, sendAt: null });
    expect(await actions().runBatch()).toMatchObject({ processed: 2 });
    expect(mails.map((m) => m.message.to)).toEqual(["user2@example.org"]);
    const exported = await actions().exportSubscribers(...as(sender))({});
    expect(exported.ok && exported.data.csv).not.toContain("user1@");

    const entry = auditEntries().find((e) => e["resourceType"] === "subscriber") as {
      id: string;
    };
    expect(entry).toMatchObject({ action: "DELETE", revertible: true });
    expect(await revertEntry(fake.db, entry.id, now)).toMatchObject({ ok: true });
    expect(await reader.listForAdmin()).toHaveLength(2);

    await actions().removeSubscriber(...as(editor))({ id });
    const legacy = "l".padEnd(64, "0");
    fake.docs.set(`subscribers/${legacy}`, {
      subscriberId: legacy,
      email: "old@example.org",
      status: "confirmed",
      confirmedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await actions().removeSubscriber(...as(editor))({ id: legacy })).toMatchObject({
      ok: true,
    });
    expect(fake.docs.get(`subscribers/${legacy}`)).toMatchObject({ version: 1 });
    const store = createSqlSubscriberStore(fake.db as unknown as Db);
    expect(await store.startOptIn(id, "user1@example.org", "h2", later(), now)).toEqual({
      optIn: 2,
    });
    expect(await reader.listForAdmin()).toHaveLength(2);
  });
});

describe("open and click tracking (web routes) and the public archive", () => {
  const sid = "c" + "1".padStart(63, "0");
  const sendOne = async () => {
    await subscribe(1, "confirmed");
    const id = await draft();
    await actions().send(...as(sender))({ id, version: 1, sendAt: null });
    return id;
  };

  it("counts each subscriber's open and click once; a click also counts as an open", async () => {
    const id = await sendOne();
    const web = createSqlCampaignWebStore(fake.db as unknown as Db);
    expect(await web.findPublic("missing")).toBeNull();
    await actions().runBatch();
    expect(await web.track("click", id, sid, now)).toBe(true);
    expect(await web.track("open", id, sid, now)).toBe(true);
    expect(await web.track("click", id, sid, now)).toBe(true);
    expect(fake.docs.get(`campaigns/${id}`)).toMatchObject({ openCount: 1, clickCount: 1 });
    expect(await web.track("open", "missing", sid, now)).toBe(false);
    expect(await web.findPublic(id)).toMatchObject({ id, subject: "Edisi Oktober" });
    await actions().remove(...as(editor))({ id, version: 2 });
    expect(await web.findPublic(id)).toBeNull();
    expect(await web.track("open", id, sid, now)).toBe(false);
  });
});
