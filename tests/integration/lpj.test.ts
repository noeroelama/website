import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlLpjStore, createSqlProgramStore } from "@website/db/sql";
import type { LpjReport } from "@website/domain/programs";
import { pdfText, renderReportPdf } from "@website/pdf";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createLpjActions, createLpjFileRoute, lpjSheet } from "../../apps/admin/src/server/lpj";
import { createProgramActions } from "../../apps/admin/src/server/programs";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlProgramStore>[0];
const clock = new Date("2026-11-04T03:00:00Z");
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

const director = staff("dir", ["programs.edit"], { type: "orgUnit", orgUnitId: "media" });
const pic = staff("pic", ["programs.read"]);
const pic2 = staff("pic2", ["programs.read", "lpj.review_secretariat"]);
const sekjen = staff("sekjen", ["programs.approve", "lpj.approve"]);
const sekre = staff("sekre", ["lpj.review_secretariat"]);
const bendahara = staff("bendahara", ["lpj.review_treasurer"]);
// Holds every desk: still only one per LPJ.
const allDesks = staff("all", ["lpj.review_secretariat", "lpj.review_treasurer", "lpj.approve"]);

let fake: ReturnType<typeof fakeDb>;
let steps: LpjReport[] = [];
let uuids = 0;
const db = () => fake.db as unknown as Db;
const programActions = () =>
  createProgramActions({
    programs: createSqlProgramStore(db()),
    unitPath: () => Promise.resolve(["dirs", "media"]),
    findUserId: (email) => Promise.resolve(email.split("@")[0] ?? null),
    afterLpj: (lpj) => {
      steps.push(lpj);
      return Promise.resolve();
    },
    now: () => clock,
    uuid: () => `m${(uuids += 1)}`,
  });
const lpjActions = () =>
  createLpjActions({
    lpj: createSqlLpjStore(db()),
    afterStep: (lpj) => {
      steps.push(lpj);
      return Promise.resolve();
    },
    now: () => clock,
  });

async function ok<T = { version: number; status: string }>(
  result: Promise<{ ok: boolean; data?: unknown }>,
): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data as T;
}

/** A programme taken from proposal to finished; returns its id (= the LPJ id). */
async function finished() {
  const { id } = await ok<{ id: string }>(
    programActions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: {
        name: "Webinar series",
        orgUnitId: "media",
        budgets: [{ amountMinor: 50000, currency: "JPY" }],
      },
      picEmails: ["pic@example.org", "pic2@example.org"],
    }),
  );
  let v = (await ok(programActions().approve(...as(sekjen))({ id, version: 1 }))).version;
  v = (await ok(programActions().saveMilestone(...as(pic))({ id, version: v, title: "Hold it" })))
    .version;
  v = (await ok(programActions().start(...as(pic))({ id, version: v }))).version;
  v = (await ok(programActions().finish(...as(pic))({ id, version: v }))).version;
  return { id, programVersion: v };
}

const report = {
  realization: "Three webinars, 120 people",
  obstacles: "Time zones",
  recommendations: "Record every session",
  participantCount: 120,
  realized: [{ amountMinor: 42000, currency: "JPY" }],
};

/** Written and submitted by the first PIC; returns the LPJ version. */
async function submittedLpj(id: string) {
  let v = (await ok(lpjActions().save(...as(pic))({ id, version: 1, ...report }))).version;
  v = (await ok(lpjActions().submit(...as(pic))({ id, version: v }))).version;
  return v;
}

beforeEach(() => {
  fake = fakeDb();
  steps = [];
  uuids = 0;
  fake.docs.set("periods/p1", { status: "active", lpjDeadlineDays: 21, deletedAt: null });
  fake.docs.set("orgUnits/media", {
    periodId: "p1",
    path: ["dirs"],
    name: "Direktorat Media",
    deletedAt: null,
  });
});

describe("finishing a programme opens its LPJ in the same transaction", () => {
  it("lpjReports/{programId}: frozen plan, due date from period.lpjDeadlineDays", async () => {
    const { id } = await finished();
    const lpj = await createSqlLpjStore(db()).get(id);
    expect(lpj).toMatchObject({
      programId: id,
      status: "draft",
      dueOn: "2026-11-25",
      pics: ["pic", "pic2"],
      orgUnitPath: ["dirs", "media"],
      version: 1,
    });
    expect(lpj?.plan).toMatchObject({
      name: "Webinar series",
      unitName: "Direktorat Media",
      budgets: [{ amountMinor: 50000, currency: "JPY" }],
      milestones: [{ title: "Hold it", done: false }],
      finishedAt: clock,
    });
    expect(steps.map((s) => s.status)).toEqual(["draft"]);
    const audit = [...fake.docs.values()].filter(
      (e) => (e as { module?: string }).module === "lpj",
    );
    expect(audit).toHaveLength(1);
    expect(await createSqlLpjStore(db()).listForPeriod("p1")).toHaveLength(1);
  });

  it("the default deadline applies when the period has none; a second LPJ is impossible", async () => {
    fake.docs.set("periods/p1", { status: "active", deletedAt: null });
    fake.docs.set("orgUnits/media", { periodId: "p1", path: ["dirs"], deletedAt: null });
    const { id } = await finished();
    const opened = await createSqlLpjStore(db()).get(id);
    expect(opened?.dueOn).toBe("2026-11-18");
    expect(opened?.plan.unitName).toBe("");
    const store = createSqlProgramStore(db());
    const program = await store.get(id);
    await expect(
      store.finish(id, program?.version as number, (p) => p, vi.fn(), vi.fn(), clock),
    ).rejects.toThrow();
  });

  it("refuses a stale version, a missing or deleted programme, and a non-PIC", async () => {
    const store = createSqlProgramStore(db());
    await expect(store.finish("ghost", 1, (p) => p, vi.fn(), vi.fn(), clock)).rejects.toThrow(
      "does not exist",
    );
    fake.docs.set("programs/gone", { deletedAt: new Date(), version: 1, milestones: [] });
    await expect(store.finish("gone", 1, (p) => p, vi.fn(), vi.fn(), clock)).rejects.toThrow(
      "trash",
    );
    await expect(store.finish("gone", 2, (p) => p, vi.fn(), vi.fn(), clock)).rejects.toThrow(
      "version",
    );
    const { id } = await ok<{ id: string }>(
      programActions().save(...as(director))({
        version: null,
        periodId: "p1",
        plan: { name: "Other", orgUnitId: "media" },
        picEmails: ["pic@example.org"],
      }),
    );
    const stranger = await programActions().finish(...as(staff("x", ["programs.read"])))({
      id,
      version: 1,
    });
    expect(stranger).toMatchObject({ ok: false, error: "refused" });
  });
});

describe("LPJ desks: separation of duties", () => {
  it("PIC writes and submits; secretariat, treasurer and approval are three other people", async () => {
    const { id } = await finished();
    const outsider = await lpjActions().save(...as(staff("x", ["programs.read"])))({
      id,
      version: 1,
      ...report,
    });
    expect(outsider).toMatchObject({ ok: false, error: "refused" });
    let v = await submittedLpj(id);

    // The submitter never reviews, even with the desk permission.
    const own = await lpjActions().reviewSecretariat(
      ...as(staff("pic", ["lpj.review_secretariat"])),
    )({ id, version: v });
    expect(own).toMatchObject({
      ok: false,
      issues: ["The submitter cannot review their own LPJ."],
    });
    // A co-PIC who did not submit may hold the secretariat desk (only the submitter is excluded).
    const noDesk = await lpjActions().reviewTreasurer(...as(sekre))({ id, version: v });
    expect(noDesk).toMatchObject({ ok: false, error: "forbidden" });

    v = (await ok(lpjActions().reviewSecretariat(...as(allDesks))({ id, version: v }))).version;
    const second = await lpjActions().reviewTreasurer(...as(allDesks))({ id, version: v });
    expect(second).toMatchObject({ ok: false, issues: [expect.stringContaining("two desks")] });
    const early = await lpjActions().approve(...as(sekjen))({ id, version: v });
    expect(early).toMatchObject({ ok: false, issues: [expect.stringContaining("Both reviews")] });
    v = (await ok(lpjActions().reviewTreasurer(...as(bendahara))({ id, version: v }))).version;
    const third = await lpjActions().approve(...as(allDesks))({ id, version: v });
    expect(third).toMatchObject({ ok: false, issues: [expect.stringContaining("two desks")] });
    const done = await ok(lpjActions().approve(...as(sekjen))({ id, version: v }));
    expect(done.status).toBe("approved");
    expect(steps.map((s) => s.status)).toEqual([
      "draft",
      "draft",
      "submitted",
      "submitted",
      "submitted",
      "approved",
    ]);
    const extend = await lpjActions().extend(...as(sekjen))({
      id,
      version: done.version,
      dueOn: "2026-12-31",
    });
    expect(extend).toMatchObject({ ok: false, error: "refused" });
  });

  it("any desk may return it with a note; return clears every desk", async () => {
    const { id } = await finished();
    let v = await submittedLpj(id);
    v = (await ok(lpjActions().reviewSecretariat(...as(sekre))({ id, version: v }))).version;
    v = (await ok(lpjActions().reviewTreasurer(...as(bendahara))({ id, version: v }))).version;
    const notADesk = await lpjActions().returnToPics(...as(staff("r", ["lpj.read"])))({
      id,
      version: v,
      note: "No",
    });
    expect(notADesk).toMatchObject({
      ok: false,
      issues: ["Only a reviewing desk can return the LPJ."],
    });
    const back = await ok(
      lpjActions().returnToPics(...as(sekjen))({ id, version: v, note: "Add the receipts" }),
    );
    expect(back.status).toBe("returned");
    const stored = await createSqlLpjStore(db()).get(id);
    expect(stored).toMatchObject({
      secretariat: null,
      treasurer: null,
      approval: null,
      revisionRound: 1,
      returnNote: "Add the receipts",
    });
    // The plan stayed frozen through every write.
    expect(stored?.plan.budgets).toEqual([{ amountMinor: 50000, currency: "JPY" }]);
    v = (await ok(lpjActions().submit(...as(pic2))({ id, version: back.version }))).version;
    // pic2 submitted this round: now pic2 cannot review, the first PIC may not either (no desk).
    const self = await lpjActions().reviewSecretariat(...as(pic2))({ id, version: v });
    expect(self).toMatchObject({ ok: false, error: "refused" });
  });

  it("the due date is extended by programs.approve only", async () => {
    const { id } = await finished();
    const byPic = await lpjActions().extend(...as(pic))({ id, version: 1, dueOn: "2026-12-31" });
    expect(byPic).toMatchObject({ ok: false, error: "forbidden" });
    const extended = await ok(
      lpjActions().extend(...as(sekjen))({ id, version: 1, dueOn: "2026-12-31" }),
    );
    expect(extended.version).toBe(2);
    expect((await createSqlLpjStore(db()).get(id))?.dueOn).toBe("2026-12-31");
    const ghost = await lpjActions().extend(...as(director))({
      id: "ghost",
      version: 1,
      dueOn: "2026-12-31",
    });
    expect(ghost).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("LPJ PDF, rendered at download time", () => {
  const names = (uids: readonly string[]) =>
    Promise.resolve(new Map(uids.map((uid) => [uid, uid === "sekre" ? "Sari Sekretariat" : uid])));
  const route = (render = renderReportPdf) =>
    createLpjFileRoute({
      getLpj: (id) => createSqlLpjStore(db()).get(id),
      names,
      render,
      now: () => clock,
      logError: vi.fn(),
    });

  it("prints signed desks with name and date, the others as not yet reviewed", async () => {
    const { id } = await finished();
    const v = await submittedLpj(id);
    await ok(lpjActions().reviewSecretariat(...as(sekre))({ id, version: v }));
    const response = await route()(id, pic);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const text = (await pdfText(new Uint8Array(await response.arrayBuffer()))).replace(/\s+/g, " ");
    expect(text).toContain("Laporan Pertanggungjawaban");
    expect(text).toContain("Sari Sekretariat, 2026-11-04");
    expect(text).toContain("Bendahara / Treasurer: Belum diperiksa / not yet reviewed");
    expect(text).toContain("Persetujuan / Approval: Belum diperiksa / not yet reviewed");
    expect(text).toContain("JPY 50,000");
    expect(text).toContain("JPY 42,000");
  });

  it("sheet text for an empty draft; access is checked; render failures are generic", async () => {
    const { id } = await finished();
    const lpj = (await createSqlLpjStore(db()).get(id)) as LpjReport;
    const sheet = lpjSheet(
      { ...lpj, plan: { ...lpj.plan, milestones: [], pics: [] } },
      new Map(),
      clock,
    );
    const lines = sheet.sections.flatMap((s) => s.lines).join("\n");
    expect(lines).toContain("Realisasi / Spent: -");
    expect(lines).toContain("Diajukan / Submitted: -");
    expect(lines).toContain("PIC: -");
    const done = lpjSheet(
      {
        ...lpj,
        plan: {
          ...lpj.plan,
          budgets: [],
          milestones: [{ title: "Hold it", dueOn: null, weight: 2, done: true }],
        },
      },
      new Map(),
      clock,
    );
    const doneLines = done.sections.flatMap((s) => s.lines).join("\n");
    expect(doneLines).toContain("[x] Hold it (weight 2)");
    expect(doneLines).toContain("Rencana / Planned: -");
    await finished();
    expect((await createSqlLpjStore(db()).listForPeriod("p1")).length).toBe(2);
    expect(lpjSheet({ ...lpj, realized: [] }, new Map(), clock).sections[2]?.lines[1]).toBe(
      "Realisasi / Spent: 0",
    );
    expect((await route()(id, null)).status).toBe(401);
    expect((await route()(id, staff("v", []))).status).toBe(403);
    expect((await route()(id, staff("x", ["events.read"]))).status).toBe(404);
    expect((await route()("../x", pic)).status).toBe(404);
    expect((await route()("ghost", pic)).status).toBe(404);
    expect((await route()(id, staff("d", ["lpj.read"]))).status).toBe(200);
    const broken = await route(() => Promise.reject(new Error("boom")))(id, pic);
    expect(broken.status).toBe(500);
  });
});
