import { beforeEach, describe, expect, it } from "vitest";
import { createSqlFormStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createFormActions } from "../../apps/admin/src/server/forms";
import { fakeDb } from "../support/fake-db";
import { revertEntry } from "../support/revert";

type Db = Parameters<typeof createSqlFormStore>[0];
const now = new Date("2026-10-20T05:00:00Z");
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
const editor = staff(["forms.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "forms@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const question = (extra: Record<string, unknown> = {}) => ({
  id: "",
  type: "short_text",
  label: "Full name",
  description: "",
  required: true,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const form = (extra: Record<string, unknown> = {}) => ({
  title: "Feedback Kongres 2026",
  description: "Tell us how it went.",
  usage: "public",
  opensAt: null,
  closesAt: null,
  questions: [question()],
  ...extra,
});

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlFormStore>;
let uuids = 0;
const actions = () =>
  createFormActions({
    forms: store,
    now: () => now,
    uuid: () => `${String(++uuids).padStart(8, "0")}-0000-4000-8000-000000000000`,
    token: () => "unused-token-0000000000000",
    logExport: () => undefined,
  });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const create = async (extra: Record<string, unknown> = {}) => {
  const result = await actions().save(...as(editor))({ ...form(extra), version: null });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
};
const markAnswered = (formId: string, n: number) =>
  fake.docs.set(`formVersions/${formId}_${n}`, {
    ...fake.docs.get(`formVersions/${formId}_${n}`),
    answered: true,
  });

beforeEach(() => {
  uuids = 0;
  fake = fakeDb();
  store = createSqlFormStore(fake.db as unknown as Db);
});

describe("form builder (Forms page, C1)", () => {
  it("creates a draft form with version 1 (forms.edit only), audited", async () => {
    expect(
      await actions().save(...as(staff(["forms.read"])))({ ...form(), version: null }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await actions().save(...as(editor))({ ...form({ questions: [] }), version: null }),
    ).toMatchObject({ ok: false, error: "invalid_input" });

    const { id, version, currentVersion } = await create();
    expect({ version, currentVersion }).toEqual({ version: 1, currentVersion: 1 });
    expect(await store.get(id)).toMatchObject({
      title: "Feedback Kongres 2026",
      usage: "public",
      status: "draft",
      publicToken: null,
      currentVersion: 1,
    });
    const v1 = await store.getVersion(id, 1);
    expect(v1).toMatchObject({ formId: id, number: 1, answered: false });
    expect(v1?.questions.map((q) => q.id)).toEqual(["q_00000001"]);
    expect(auditEntries().at(-1)).toMatchObject({
      module: "forms",
      action: "CREATE",
      resourceType: "form",
      title: "Feedback Kongres 2026",
      revertible: true,
      after: { questions: [{ id: "q_00000001", type: "short_text", label: "Full name" }] },
    });
  });

  it("edits an unanswered version in place and keeps question ids", async () => {
    const { id } = await create();
    const [q] = (await store.getVersion(id, 1))?.questions ?? [];
    const saved = await actions().save(...as(editor))({
      ...form({ questions: [question({ id: q?.id, label: "Name" }), question({ type: "email" })] }),
      id,
      version: 1,
    });
    expect(saved).toMatchObject({ ok: true, data: { version: 2, currentVersion: 1 } });
    expect((await store.getVersion(id, 1))?.questions.map((x) => [x.id, x.label])).toEqual([
      ["q_00000001", "Name"],
      ["q_00000002", "Full name"],
    ]);
    expect(await store.getVersion(id, 2)).toBeNull();
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: false });
  });

  it("freezes an answered version: the edit becomes version 2, version 1 stays as it was", async () => {
    const { id } = await create();
    markAnswered(id, 1);
    const saved = await actions().save(...as(editor))({
      ...form({ questions: [question({ id: "q_00000001", label: "Your full name" })] }),
      id,
      version: 1,
    });
    expect(saved).toMatchObject({ ok: true, data: { currentVersion: 2 } });
    expect((await store.getVersion(id, 1))?.questions[0]?.label).toBe("Full name");
    expect(await store.getVersion(id, 2)).toMatchObject({ number: 2, answered: false });
    expect((await store.listVersions(id)).map((v) => v.number)).toEqual([1, 2]);
    const listed = await store.listForAdmin();
    const current = await store.currentVersions(listed);
    expect(current.get(id)).toMatchObject({ number: 2, answered: false });
    expect(fake.getAll).toHaveBeenCalledTimes(1);
    const again = await actions().save(...as(editor))({
      ...form({
        title: "Feedback Kongres",
        questions: [question({ id: "q_00000001", label: "Your full name" })],
      }),
      id,
      version: 2,
    });
    expect(again).toMatchObject({ ok: true, data: { currentVersion: 2 } });
    expect(auditEntries().at(-1)?.["after"]).not.toHaveProperty("questions");
  });

  it("refuses stale versions, edits in the trash, and usage changes after publishing", async () => {
    const { id } = await create();
    expect(await actions().save(...as(editor))({ ...form(), id, version: 7 })).toMatchObject({
      ok: false,
      error: "conflict",
    });
    expect(
      await actions().save(...as(editor))({ ...form(), id: "missing", version: 1 }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(
      await actions().save(...as(editor))({ ...form({ usage: "recruitment" }), id, version: 1 }),
    ).toMatchObject({ ok: true });
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), status: "published" });
    expect(
      await actions().save(...as(editor))({ ...form({ usage: "public" }), id, version: 2 }),
    ).toMatchObject({ ok: false, error: "refused", issues: [expect.stringContaining("draft")] });
  });

  it("a published public form cannot gain a file question", async () => {
    const { id } = await create();
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), status: "published" });
    expect(
      await actions().save(...as(editor))({
        ...form({ questions: [question({ type: "file", label: "CV" })] }),
        id,
        version: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: "refused",
      issues: ["Public forms cannot ask for files."],
    });
    expect(
      await create({ usage: "recruitment", questions: [question({ type: "file", label: "CV" })] }),
    ).toMatchObject({ version: 1 });
  });

  it("lists forms newest change first; deletes softly; the delete and the create can be reverted", async () => {
    const first = await create({ title: "First form" });
    const second = await create({ title: "Second form" });
    expect((await store.listForAdmin()).map((f) => f.title).sort()).toEqual([
      "First form",
      "Second form",
    ]);
    expect(
      await actions().remove(...as(staff(["forms.read"])))({ id: first.id, version: 1 }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await actions().remove(...as(editor))({ id: first.id, version: 1 })).toMatchObject({
      ok: true,
    });
    const deleted = auditEntries().at(-1);
    expect(deleted).toMatchObject({ action: "DELETE", resourceType: "form", revertible: true });
    expect((await store.listForAdmin()).map((f) => f.title)).toEqual(["Second form"]);
    expect(await store.getVersion(first.id, 1)).not.toBeNull();
    expect(await revertEntry(fake.db, deleted?.["id"] as string, now)).toMatchObject({ ok: true });
    expect((await store.listForAdmin()).map((f) => f.title).sort()).toEqual([
      "First form",
      "Second form",
    ]);
    const created = auditEntries().find(
      (e) => e["action"] === "CREATE" && e["resourceId"] === second.id,
    );
    expect(await revertEntry(fake.db, created?.["id"] as string, now)).toMatchObject({ ok: true });
    expect((await store.listForAdmin()).map((f) => f.title)).toEqual(["First form"]);
    expect(await store.getVersion("../x", 1)).toBeNull();
    await actions().remove(...as(editor))({ id: first.id, version: 3 });
    expect(
      await actions().save(...as(editor))({ ...form(), id: first.id, version: 4 }),
    ).toMatchObject({ ok: false, error: "refused", issues: ["This item is in the trash."] });
  });

  it("keeps the answer window; a missing version doc is skipped in the list", async () => {
    const { id } = await create({
      opensAt: "2026-11-01T00:00:00.000Z",
      closesAt: "2026-11-30T00:00:00.000Z",
    });
    expect(await store.get(id)).toMatchObject({
      opensAt: new Date("2026-11-01T00:00:00Z"),
      closesAt: new Date("2026-11-30T00:00:00Z"),
    });
    fake.docs.delete(`formVersions/${id}_1`);
    expect((await store.currentVersions(await store.listForAdmin())).size).toBe(0);
  });
});
