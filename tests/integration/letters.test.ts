import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createFirestoreLetterSettingsStore,
  createFirestoreLetterStore,
  createFirestoreLetterTypeStore,
} from "@website/db/firestore";
import { DEFAULT_LETTERHEAD, letterCanonical, type Letter } from "@website/domain/documents";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createLetterActions } from "../../apps/admin/src/server/letters";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreLetterStore>[0];
const clock = new Date("2026-11-02T03:00:00Z");
let clockShift = 0;
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const secretariat = staff("sekre", [
  "letters.edit",
  "letters.review",
  "letters.issue",
  "letters.cancel",
  "letter_types.edit",
]);
const sekjen = staff("sekjen", ["letters.sign", "letters.read"]);
const koordinator = staff("koor", ["letters.sign_coordinator", "letters.sign"]);
const director = staff("dir", ["letters.edit"], { type: "orgUnit", orgUnitId: "media" });

let fake: ReturnType<typeof fakeFirestore>;
let afterIssue: Letter[] = [];
const db = () => fake.db as unknown as Db;
const letters = () => createFirestoreLetterStore(db());
const actions = () =>
  createLetterActions({
    letters: letters(),
    types: createFirestoreLetterTypeStore(db()),
    settings: createFirestoreLetterSettingsStore(db()),
    afterIssue: (letter) => {
      afterIssue.push(letter);
      return Promise.resolve();
    },
    unitPath: (id) => {
      const unit = fake.docs.get(`orgUnits/${id}`) as { path: string[] } | undefined;
      return Promise.resolve(unit ? [...unit.path, id] : null);
    },
    now: () => new Date(clock.getTime() + clockShift * 60_000),
  });

const draft = {
  typeId: "",
  orgUnitId: "sekjen",
  subject: "Undangan rapat kerja",
  body: '<p onclick="x()">Dengan hormat,</p><script>alert(1)</script>',
  recipient: "Ketua PPI Jepang",
  place: "Tokyo",
  attachmentNote: "-",
  letterDate: "2026-11-02",
};

beforeEach(() => {
  fake = fakeFirestore();
  afterIssue = [];
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
  fake.docs.set("periods/p1", { name: "2026/2027" });
  fake.docs.set("orgUnits/sekjen", {
    periodId: "p1",
    path: [],
    code: "SEKJEN",
    name: "Sekretariat Jenderal",
    active: true,
    deletedAt: null,
  });
  fake.docs.set("orgUnits/media", {
    periodId: "p1",
    path: ["dirs"],
    code: "MEDIA",
    name: "Direktorat Media",
    active: true,
    deletedAt: null,
  });
  fake.docs.set("orgUnits/old", {
    periodId: "p0",
    path: [],
    code: "OLD",
    name: "Old",
    deletedAt: null,
  });
  fake.docs.set("users/sekjen", { name: "Account Name", email: "sekjen@example.org" });
  fake.docs.set("users/koor", { name: null, email: "koor@example.org" });
  fake.docs.set("appointments/a1", {
    userId: "sekjen",
    periodId: "p1",
    status: "active",
    name: "Rina Sekjen",
    title: "Sekretaris Jenderal",
  });
});

async function createType(extra: Record<string, unknown> = {}) {
  const result = await actions().saveType(...as(secretariat))({
    name: "Surat Undangan",
    code: "SU",
    numberFormat: "{nomor}/{jenis}/{unit}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}",
    version: null,
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data.id;
}

async function approvedLetter(typeExtra: Record<string, unknown> = {}) {
  const typeId = await createType(typeExtra);
  const created = await actions().save(...as(secretariat))({ ...draft, typeId, version: null });
  if (!created.ok) throw new Error(JSON.stringify(created));
  const { id } = created.data;
  let version = created.data.version;
  const next = async (result: Promise<{ ok: boolean; data?: { version: number } }>) => {
    const r = await result;
    if (!r.ok) throw new Error(JSON.stringify(r));
    version = (r.data as { version: number }).version;
  };
  await next(actions().submit(...as(secretariat))({ id, version }));
  await next(actions().pass(...as(secretariat))({ id, version }));
  await next(actions().signSecretary(...as(sekjen))({ id, version }));
  if (typeExtra["requiresCoordinator"]) {
    await next(actions().signCoordinator(...as(koordinator))({ id, version }));
  }
  return { id, version, typeId };
}

describe("letter types", () => {
  it("codes are unique case-insensitively; patterns are checked", async () => {
    await createType();
    const twin = await actions().saveType(...as(secretariat))({
      name: "Other",
      code: "su",
      numberFormat: "{nomor}",
      version: null,
    });
    expect(twin).toMatchObject({ ok: false, error: "refused" });
    const bad = await actions().saveType(...as(secretariat))({
      name: "Bad",
      code: "BAD",
      numberFormat: "{nomor}/{year}",
      version: null,
    });
    expect(bad).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: { numberFormat: "Unknown placeholder {year}." },
    });
    const sk = await createType({ name: "Surat Keputusan", code: "SK", sort: 0 });
    const typeStore = createFirestoreLetterTypeStore(db());
    await createType({ name: "Surat Edaran", code: "SE", sort: 0 });
    expect((await typeStore.list()).map((t) => t.code)).toEqual(["SE", "SK", "SU"]);
    const renamed = await actions().saveType(...as(secretariat))({
      name: "Surat Keputusan Koordinator",
      code: "SK",
      numberFormat: "{nomor}/{jenis}/{tahun}",
      requiresCoordinator: true,
      id: sk,
      version: 1,
    });
    expect(renamed).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await typeStore.get(sk)).toMatchObject({ requiresCoordinator: true, version: 2 });
    expect(
      await actions().saveType(...as(sekjen))({
        name: "X",
        code: "X",
        numberFormat: "{nomor}",
        version: null,
      }),
    ).toMatchObject({ error: "forbidden" });
  });
});

describe("letters workflow", () => {
  it("drafts are sanitized, scoped to the period's units and editable until corrected", async () => {
    const typeId = await createType({ requiresRecipient: false });
    const created = await actions().save(...as(secretariat))({ ...draft, typeId, version: null });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data.id : "";
    const stored = await letters().get(id);
    expect(stored).toMatchObject({
      periodId: "p1",
      orgUnitPath: ["sekjen"],
      status: "draft",
      recipient: "",
      createdBy: "sekre",
      body: "<p>Dengan hormat,</p>",
    });
    const other = await actions().save(...as(secretariat))({
      ...draft,
      typeId,
      orgUnitId: "old",
      version: null,
    });
    expect(other).toMatchObject({
      ok: false,
      error: "refused",
      issues: ["Choose a unit of this board period."],
    });
    const edited = await actions().save(...as(secretariat))({
      ...draft,
      typeId,
      subject: "Rapat",
      id,
      version: 1,
    });
    expect(edited).toMatchObject({ ok: true, data: { version: 2 } });
    expect(
      await actions().save(...as(secretariat))({ ...draft, typeId, id, version: 1 }),
    ).toMatchObject({ error: "conflict" });
  });

  it("refuses unknown or unused types, a missing period, and edits after correction", async () => {
    const typeId = await createType();
    const off = await createType({ code: "OFF", active: false });
    expect(
      await actions().save(...as(secretariat))({ ...draft, typeId: "nope", version: null }),
    ).toMatchObject({
      error: "refused",
      issues: ["This letter type does not exist."],
    });
    expect(
      await actions().save(...as(secretariat))({ ...draft, typeId: off, version: null }),
    ).toMatchObject({
      issues: ["This letter type is not in use."],
    });
    const created = await actions().save(...as(secretariat))({ ...draft, typeId, version: null });
    const id = created.ok ? created.data.id : "";
    const moved = await actions().save(...as(secretariat))({
      ...draft,
      typeId,
      orgUnitId: "media",
      id,
      version: 1,
    });
    expect(moved.ok && (await letters().get(id))?.orgUnitPath).toEqual(["dirs", "media"]);
    await actions().save(...as(secretariat))({ ...draft, typeId, id, version: 2 });
    await actions().submit(...as(secretariat))({ id, version: 3 });
    await actions().pass(...as(secretariat))({ id, version: 4 });
    expect(
      await actions().save(...as(secretariat))({ ...draft, typeId, id, version: 5 }),
    ).toMatchObject({
      issues: ["Only drafts and letters under review can be edited."],
    });
    expect(await actions().remove(...as(secretariat))({ id, version: 5 })).toMatchObject({
      issues: ["Only drafts can be deleted."],
    });
    fake.docs.delete("settings/activePeriod");
    expect(
      await actions().save(...as(secretariat))({ ...draft, typeId, version: null }),
    ).toMatchObject({
      issues: ["Activate a board period first."],
    });
  });

  it("lists page by creation date and filter by status", async () => {
    const typeId = await createType();
    const ids: string[] = [];
    for (const minute of [1, 2, 3]) {
      clockShift = minute;
      const saved = await actions().save(...as(secretariat))({ ...draft, typeId, version: null });
      ids.push(saved.ok ? saved.data.id : "");
    }
    clockShift = 0;
    const [a, b, c] = ids;
    const first = await letters().list({ periodId: "p1", orgUnitIds: "all", limit: 2 });
    expect(first.items.map((l) => l.id)).toEqual([c, b]);
    const second = await letters().list({
      periodId: "p1",
      orgUnitIds: "all",
      limit: 2,
      cursor: first.nextCursor ?? "",
    });
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.items.map((l) => l.id)).toEqual([a]);
    await actions().submit(...as(secretariat))({ id: a as string, version: 1 });
    const review = await letters().list({
      periodId: "p1",
      orgUnitIds: "all",
      status: "review",
      limit: 10,
    });
    expect(review.items.map((l) => l.id)).toEqual([a]);
  });

  it("a director writes only for their unit and never sees other units' letters", async () => {
    const typeId = await createType();
    expect(
      await actions().save(...as(director))({
        ...draft,
        typeId,
        orgUnitId: "ghost",
        version: null,
      }),
    ).toMatchObject({ error: "forbidden" });
    expect(
      await actions().save(...as(director))({ ...draft, typeId, version: null }),
    ).toMatchObject({ error: "forbidden" });
    const own = await actions().save(...as(director))({
      ...draft,
      typeId,
      orgUnitId: "media",
      version: null,
    });
    expect(own.ok).toBe(true);
    const id = own.ok ? own.data.id : "";
    expect(await letters().get(id)).toMatchObject({ orgUnitPath: ["dirs", "media"] });
    const moved = await actions().save(...as(director))({
      ...draft,
      typeId,
      orgUnitId: "sekjen",
      id,
      version: 1,
    });
    expect(moved).toMatchObject({
      ok: false,
      error: "refused",
      issues: ["You can only write letters for your own unit."],
    });
    const central = await actions().save(...as(secretariat))({ ...draft, typeId, version: null });
    const centralId = central.ok ? central.data.id : "";
    expect(await actions().submit(...as(director))({ id: centralId, version: 1 })).toMatchObject({
      error: "forbidden",
    });
    const listed = await letters().list({ periodId: "p1", orgUnitIds: ["media"], limit: 10 });
    expect(listed.items.map((l) => l.id)).toEqual([id]);
    expect((await letters().list({ periodId: "p1", orgUnitIds: [], limit: 10 })).items).toEqual([]);
    expect(
      (await letters().list({ periodId: "p1", orgUnitIds: "all", limit: 10 })).items,
    ).toHaveLength(2);
    expect(await actions().remove(...as(director))({ id, version: 1 })).toMatchObject({ ok: true });
    expect(
      (await letters().list({ periodId: "p1", orgUnitIds: "all", limit: 10 })).items,
    ).toHaveLength(1);
  });

  it("issue numbers, codes and freezes the letter in one transaction; numbers never repeat", async () => {
    const { id, version } = await approvedLetter({ requiresCoordinator: true });
    const result = await actions().issue(...as(secretariat))({ id, version });
    expect(result).toMatchObject({
      ok: true,
      data: { numberFormatted: "001/SU/SEKJEN/PPIDK-ASIANIA/XI/2026" },
    });
    const issued = (await letters().get(id)) as Letter;
    expect(issued).toMatchObject({
      status: "issued",
      number: 1,
      issuedAt: clock,
      secretary: { uid: "sekjen" },
      coordinator: { uid: "koor" },
    });
    expect(issued.signers).toEqual([
      {
        name: "koor@example.org",
        desk: "Koordinator PPIDK Asia-Oseania",
        position: null,
        period: "2026/2027",
        at: clock,
      },
      {
        name: "Rina Sekjen",
        desk: "Sekretaris Jenderal PPIDK Asia-Oseania",
        position: "Sekretaris Jenderal",
        period: "2026/2027",
        at: clock,
      },
    ]);
    expect(issued.contentDigest).toBe(
      createHash("sha256").update(letterCanonical(issued, "SU")).digest("hex"),
    );
    expect(issued.verificationCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(issued).toMatchObject({ letterhead: DEFAULT_LETTERHEAD, archive: null });
    expect(afterIssue.map((l) => l.id)).toEqual([id]);
    expect(fake.docs.get(`verificationCodes/${issued.verificationCode}`)).toEqual({
      kind: "letter",
      letterId: id,
      periodId: "p1",
    });
    expect(
      await actions().issue(...as(secretariat))({ id, version: issued.version }),
    ).toMatchObject({ error: "refused" });

    const cancelled = await actions().cancel(...as(secretariat))({
      id,
      version: issued.version,
      reason: "Wrong date",
    });
    expect(cancelled).toMatchObject({ ok: true, data: { status: "cancelled" } });
    const second = await approvedLetter({ requiresCoordinator: true, code: "SU2" });
    const next = await actions().issue(...as(secretariat))({
      id: second.id,
      version: second.version,
    });
    expect(next).toMatchObject({
      ok: true,
      data: { numberFormatted: "001/SU2/SEKJEN/PPIDK-ASIANIA/XI/2026" },
    });
    expect(fake.docs.get(`letterCounters/p1_${second.typeId}`)).toEqual({ last: 1 });
    const audit = [...fake.docs.entries()]
      .filter(([path]) => path.startsWith("auditLogs/"))
      .map(([, e]) => (e as { action: string }).action);
    expect(audit).toContain("PUBLISH");
    expect(audit).toContain("UNPUBLISH");
  });

  it("refuses issue before approval, uploads, and the wrong desks; returning clears the desks", async () => {
    const { id, version } = await approvedLetter();
    const letter = (await letters().get(id)) as Letter;
    expect(letter).toMatchObject({ status: "approved", coordinator: null });
    expect(await actions().issue(...as(sekjen))({ id, version })).toMatchObject({
      error: "forbidden",
    });
    const back = await actions().returnToDraft(...as(secretariat))({
      id,
      version,
      note: "Fix the place",
    });
    expect(back).toMatchObject({ ok: true, data: { status: "draft" } });
    expect(await letters().get(id)).toMatchObject({ secretary: null, reviewNote: "Fix the place" });
    const v = back.ok ? back.data.version : 0;
    expect(await actions().issue(...as(secretariat))({ id, version: v })).toMatchObject({
      error: "refused",
      issues: ["The signing desks must approve the letter before it is issued."],
    });
    expect(await actions().signSecretary(...as(sekjen))({ id, version: v })).toMatchObject({
      error: "refused",
    });
    expect(
      await actions().cancel(...as(secretariat))({ id, version: v, reason: "x" }),
    ).toMatchObject({ error: "refused" });
    expect(await actions().issue(...as(secretariat))({ id: "missing", version: 1 })).toMatchObject({
      error: "refused",
    });
    expect(await actions().issue(...as(secretariat))({ id, version: 99 })).toMatchObject({
      error: "conflict",
    });
    fake.docs.set(`letters/${id}`, {
      ...fake.docs.get(`letters/${id}`),
      status: "approved",
      source: "upload",
    });
    expect(await actions().issue(...as(secretariat))({ id, version: v })).toMatchObject({
      error: "refused",
    });
    fake.docs.set(`letters/${id}`, { ...fake.docs.get(`letters/${id}`), deletedAt: clock });
    expect(await actions().issue(...as(secretariat))({ id, version: v })).toMatchObject({
      error: "refused",
    });
  });

  it("unit letters sign with the unit's name; a taken code is skipped, never reused", async () => {
    fake.docs.set("users/sekjen2", { name: "Second Sekjen", email: "s2@example.org" });
    const typeId = await createType();
    const created = await actions().save(...as(secretariat))({
      ...draft,
      typeId,
      orgUnitId: "media",
      version: null,
    });
    const id = created.ok ? created.data.id : "";
    await actions().submit(...as(secretariat))({ id, version: 1 });
    await actions().pass(...as(secretariat))({ id, version: 2 });
    await actions().signSecretary(...as(staff("sekjen2", ["letters.sign"])))({ id, version: 3 });
    fake.docs.set("verificationCodes/AAAAA-AAAAA", { kind: "letter", letterId: "older" });
    let calls = 0;
    // First code: all zeros (taken); then all ones.
    const store = createFirestoreLetterStore(db(), () => (calls++ < 10 ? 0 : 1));
    const issued = await store
      .issue(id, 4, DEFAULT_LETTERHEAD, () => ({}) as never, clock)
      .catch((e: Error) => e);
    expect(issued).toBeInstanceOf(Error);
    calls = 0;
    const audited = (_b: unknown, _a: unknown, _c: unknown, next: Letter) =>
      ({
        id: `audit-${next.id}`,
        occurredAt: clock,
        actor: { type: "staff", id: "sekre", email: null },
        action: "PUBLISH",
        module: "letters",
        resourceType: "letter",
        resourceId: next.id,
        title: "x",
        before: null,
        after: null,
        versionBefore: 4,
        versionAfter: 5,
        operationId: "op",
        revertible: false,
      }) as never;
    const letter = await store.issue(id, 4, DEFAULT_LETTERHEAD, audited, clock);
    expect(letter).toMatchObject({
      verificationCode: "BBBBB-BBBBB",
      numberFormatted: "001/SU/MEDIA/PPIDK-ASIANIA/XI/2026",
    });
    expect(letter.signers).toEqual([
      {
        name: "Second Sekjen",
        desk: "Direktorat Media",
        position: null,
        period: "2026/2027",
        at: clock,
      },
    ]);
    const unlucky = createFirestoreLetterStore(db(), () => 0);
    const again = await approvedLetter({ code: "SU3" });
    fake.docs.set("verificationCodes/AAAAA-AAAAA", { kind: "letter", letterId: "older" });
    await expect(
      unlucky.issue(again.id, again.version, DEFAULT_LETTERHEAD, audited, clock),
    ).rejects.toThrow("No free verification code.");
  });

  it("the letterhead is versioned, audited and frozen on letters issued after it", async () => {
    const settings = createFirestoreLetterSettingsStore(db());
    expect(await settings.get()).toEqual({ letterhead: DEFAULT_LETTERHEAD, version: null });
    const letterhead = { ...DEFAULT_LETTERHEAD, address: "Tokyo, Japan", initialsBox: true };
    const saved = await actions().saveLetterhead(...as(secretariat))({ letterhead, version: null });
    expect(saved).toMatchObject({ ok: true, data: { version: 1 } });
    expect(await settings.get()).toEqual({ letterhead, version: 1 });
    expect(
      await actions().saveLetterhead(...as(secretariat))({ letterhead, version: null }),
    ).toMatchObject({
      error: "conflict",
    });
    const foreign = await actions().saveLetterhead(...as(secretariat))({
      letterhead: {
        ...letterhead,
        header: { path: "members/ktm/x.webp", url: "https://x.test/a", width: 10, height: 10 },
      },
      version: 1,
    });
    expect(foreign).toMatchObject({ error: "invalid_input" });
    const { id, version } = await approvedLetter();
    await actions().issue(...as(secretariat))({ id, version });
    expect((await letters().get(id))?.letterhead).toEqual(letterhead);
    const archive = { path: `letters/p1/${id}_aaaa.pdf`, sha256: "a".repeat(64), size: 10 };
    expect(await letters().setArchive(id, archive)).toEqual(archive);
    expect(await letters().setArchive(id, { ...archive, path: "other" })).toEqual(archive);
  });
});
