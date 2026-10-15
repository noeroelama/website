import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createFirestoreAuditStore, createFirestoreAuditWriter } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createAuditLogActions } from "../../apps/admin/src/server/audit-log";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreAuditStore>[0];
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-16T12:00:00Z");

const entry = (id: string, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id,
  occurredAt: new Date(now.getTime() - DAY),
  actor: { type: "staff", id: "editor-1", email: "editor@example.org" },
  action: "UPDATE",
  module: "articles",
  title: "Hello",
  resourceType: "testItem",
  resourceId: "t1",
  operationId: `op-${id}`,
  before: { title: "Old", summary: null },
  after: { title: "New", summary: "Added" },
  versionBefore: 1,
  versionAfter: 2,
  revertible: true,
  revertOf: null,
  request: { requestId: "req-123456" },
  prevHash: null,
  hash: null,
  ...over,
});

const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "boss",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const fresh = () =>
  Promise.resolve({
    actorEmail: "boss@example.org",
    requestId: "req-999999",
    authTime: Date.now() / 1000, // the recent-sign-in check uses the real clock
  });

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestoreAuditStore>;
const write = async (...events: AuditEvent[]) => {
  const writer = createFirestoreAuditWriter(fake.db as unknown as Db);
  for (const event of events) await writer.appendAlone(event);
};
const actions = () =>
  createAuditLogActions({
    audit: store,
    // How each module's records are reverted (a test module here; content modules add theirs).
    revertible: { testItem: "testItems" },
    now: () => now,
    logSecurityEvent: () => undefined,
  });
const revert = (id: string, principal = staff(["audit.read", "audit.revert"])) =>
  actions().revert(() => Promise.resolve(principal), fresh)({ id });

beforeEach(() => {
  fake = fakeFirestore();
  store = createFirestoreAuditStore(fake.db as unknown as Db);
  fake.docs.set("testItems/t1", { title: "New", summary: "Added", body: "same", version: 2 });
});

describe("Audit Log page: list and filters", () => {
  it("lists newest first, page by page, filtered by admin, module, action and date range", async () => {
    await write(
      entry("a1", { occurredAt: new Date(now.getTime() - 3 * DAY) }),
      entry("a2", { action: "PUBLISH", occurredAt: new Date(now.getTime() - 2 * DAY) }),
      entry("a3", {
        module: "events",
        actor: { type: "staff", id: "x", email: "other@example.org" },
        occurredAt: new Date(now.getTime() - DAY),
      }),
    );
    const first = await store.list({ limit: 2 });
    expect(first.items.map((e) => e.id)).toEqual(["a3", "a2"]);
    expect(first.items[0]?.occurredAt).toBeInstanceOf(Date);
    const second = await store.list({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second).toMatchObject({ items: [{ id: "a1" }], nextCursor: null });

    const ids = async (filters: Parameters<typeof store.list>[0]) =>
      (await store.list(filters)).items.map((e) => e.id);
    expect(await ids({ limit: 10, actorEmail: "other@example.org" })).toEqual(["a3"]);
    expect(await ids({ limit: 10, module: "articles" })).toEqual(["a2", "a1"]);
    expect(await ids({ limit: 10, action: "PUBLISH" })).toEqual(["a2"]);
    expect(
      await ids({
        limit: 10,
        from: new Date(now.getTime() - 2.5 * DAY),
        to: new Date(now.getTime() - 1.5 * DAY),
      }),
    ).toEqual(["a2"]);
  });

  it("tells each entry whether it can be reverted, and why not", async () => {
    await write(
      entry("ok"),
      entry("old", { occurredAt: new Date(now.getTime() - 15 * DAY) }),
      entry("sent", { action: "SEND", revertible: false }),
      entry("other", { resourceType: "unknownThing" }),
      entry("stale", { versionAfter: 1 }),
      entry("gone", { resourceId: "no-such-record" }),
    );
    const page = await store.list({ limit: 10 });
    const status = await actions().revertStatus(page.items);
    expect(Object.fromEntries(status)).toEqual({
      ok: { allowed: true },
      old: { allowed: false, reason: "window_expired" },
      sent: { allowed: false, reason: "not_revertible" },
      other: { allowed: false, reason: "not_revertible" },
      stale: { allowed: false, reason: "version_conflict" },
      gone: { allowed: false, reason: "version_conflict" },
    });
    // The revert itself re-checks: a record type nobody registered is never written.
    expect(await revert("other")).toMatchObject({ error: "refused" });
    expect(await revert("ok")).toMatchObject({ ok: true });
    const after = await actions().revertStatus(page.items);
    expect(after.get("ok")).toEqual({ allowed: false, reason: "already_reverted" });
  });
});

describe("revert (14 days, only the listed fields, a NEW entry)", () => {
  it("restores the Before values of the listed fields and appends a REVERT entry; the original stays", async () => {
    await write(entry("a1"));
    const original = JSON.stringify(fake.docs.get("auditLogs/a1"));
    expect(await revert("a1")).toMatchObject({ ok: true });
    expect(fake.docs.get("testItems/t1")).toMatchObject({
      title: "Old",
      summary: null,
      body: "same",
      version: 3,
    });
    const reverts = [...fake.docs.entries()].filter(
      ([path, data]) => path.startsWith("auditLogs/") && data["revertOf"] === "a1",
    );
    expect(reverts).toHaveLength(1);
    expect(reverts[0]?.[1]).toMatchObject({
      action: "REVERT",
      module: "articles",
      before: { title: "New", summary: "Added" },
      after: { title: "Old", summary: null },
      versionBefore: 2,
      versionAfter: 3,
      actor: { type: "staff", id: "boss", email: "boss@example.org" },
    });
    expect(JSON.stringify(fake.docs.get("auditLogs/a1"))).toBe(original);
    // Never twice.
    expect(await revert("a1")).toMatchObject({
      error: "refused",
      issues: ["Already reverted"],
    });
  });

  it("refuses after 14 days, after a later edit, for side effects and for a revert itself", async () => {
    await write(
      entry("old", { occurredAt: new Date(now.getTime() - 14 * DAY - 1) }),
      entry("sent", { action: "SEND", revertible: false }),
    );
    expect(await revert("old")).toMatchObject({ issues: ["Revert window expired"] });
    expect(await revert("sent")).toMatchObject({ error: "refused" });
    fake.docs.set("testItems/t1", { title: "Newer", version: 5 });
    await write(entry("a1"));
    expect(await revert("a1")).toMatchObject({
      issues: ["The record changed after this entry"],
    });
    await write(entry("r1", { action: "REVERT", revertOf: "zzz" }));
    expect(await revert("r1")).toMatchObject({ issues: ["A revert cannot be reverted"] });
    expect(await revert("missing")).toMatchObject({ issues: ["This entry does not exist."] });
  });

  it("undoes a create by moving the record to trash, and a delete by restoring it", async () => {
    fake.docs.set("testItems/t1", { title: "New", version: 1, deletedAt: null });
    await write(
      entry("c1", { action: "CREATE", before: null, versionBefore: null, versionAfter: 1 }),
    );
    expect(await revert("c1")).toMatchObject({ ok: true });
    expect(fake.docs.get("testItems/t1")?.["deletedAt"]).toBeTruthy();

    fake.docs.set("testItems/t2", { title: "Gone", version: 4, deletedAt: now });
    await write(
      entry("d1", {
        action: "DELETE",
        resourceId: "t2",
        after: null,
        versionBefore: 3,
        versionAfter: 4,
      }),
    );
    expect(await revert("d1")).toMatchObject({ ok: true });
    expect(fake.docs.get("testItems/t2")).toMatchObject({ deletedAt: null, version: 5 });
  });

  it("needs audit.revert and a sign-in in the last 15 minutes", async () => {
    await write(entry("a1"));
    expect(await revert("a1", staff(["audit.read"]))).toEqual({ ok: false, error: "forbidden" });
    const stale = () =>
      Promise.resolve({
        actorEmail: null,
        requestId: "req-1",
        authTime: Date.now() / 1000 - 3600,
      });
    expect(
      await actions().revert(() => Promise.resolve(staff(["audit.revert"])), stale)({ id: "a1" }),
    ).toEqual({ ok: false, error: "reauthenticate" });
    expect(fake.docs.get("testItems/t1")).toMatchObject({ version: 2 });
  });
});
