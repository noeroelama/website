import { beforeEach, describe, expect, it } from "vitest";
import { createSqlFinanceStore } from "@website/db/sql";
import type { FinanceRequest } from "@website/domain/finance";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createFinanceActions } from "../../apps/admin/src/server/finance";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlFinanceStore>[0];
const clock = new Date("2026-11-04T03:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
  active = true,
): Principal => ({
  kind: "user",
  userId,
  active,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

/** A director asks for money for their unit; the treasurer and coordinator are other people. */
const director = staff("ari", ["finance.edit"], { type: "orgUnit", orgUnitId: "media" });
const treasurer = staff("bendahara", ["finance.review", "finance.pay"]);
const coordinator = staff("koor", ["finance.authorize", "finance.review"]);
const pdf = new TextEncoder().encode("%PDF-1.7 rab");

let fake: ReturnType<typeof fakeDb>;
let files: Map<string, Uint8Array>;
let steps: string[];
let uuid = 0;
const store = () => createSqlFinanceStore(fake.db as unknown as Db);
const actions = () =>
  createFinanceActions({
    requests: store(),
    unitPath: (id) => {
      const unit = fake.docs.get(`orgUnits/${id}`) as { path: string[] } | undefined;
      return Promise.resolve(unit ? [...unit.path, id] : null);
    },
    storage: {
      save: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
      read: (path) => Promise.resolve(files.get(path) ?? null),
    },
    afterStep: (request) => {
      steps.push(request.status);
      return Promise.resolve();
    },
    now: () => clock,
    uuid: () => `0000000${(uuid += 1)}-aaaa`,
  });

const draft = {
  category: "disbursement",
  orgUnitId: "media",
  title: "Webinar AI",
  amountMinor: 150_000_000,
  currency: "IDR",
  date: "2026-11-20",
  account: "BNI 123 a.n. PPIDK",
  fundSource: "Kas pusat",
  programId: "prog-1",
};

beforeEach(() => {
  fake = fakeDb();
  files = new Map();
  steps = [];
  uuid = 0;
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
  fake.docs.set("orgUnits/media", {
    periodId: "p1",
    path: ["dirs"],
    name: "Direktorat Media",
    deletedAt: null,
  });
  fake.docs.set("orgUnits/sekjen", { periodId: "p1", path: [], name: "Sekjen", deletedAt: null });
  fake.docs.set("orgUnits/old", { periodId: "p0", path: [], name: "Old", deletedAt: null });
});

async function created(input: Record<string, unknown> = draft) {
  const result = await actions().save(...as(director))({ ...input, version: null });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
}
const get = async (id: string) => (await store().get(id)) as FinanceRequest;

describe("finance requests: drafts (I1)", () => {
  it("creates a draft in the active period for the requester's unit, with an audit entry", async () => {
    const { id, version } = await created();
    expect(version).toBe(1);
    expect(await get(id)).toMatchObject({
      periodId: "p1",
      orgUnitPath: ["dirs", "media"],
      status: "draft",
      createdBy: "ari",
      programId: "prog-1",
      documents: [],
      revisionRound: 0,
    });
    const audit = [...fake.docs.entries()].find(([key]) => key.startsWith("auditLogs/"));
    expect(audit?.[1]).toMatchObject({ module: "finance", action: "CREATE", title: "Webinar AI" });
    expect(await store().list({ periodId: "p1", orgUnitIds: "all", limit: 10 })).toHaveLength(1);
    expect(await store().list({ periodId: "p1", orgUnitIds: ["media"], limit: 10 })).toHaveLength(
      1,
    );
    expect(await store().list({ periodId: "p1", orgUnitIds: ["sekjen"], limit: 10 })).toEqual([]);
    expect(await store().list({ periodId: "p1", orgUnitIds: [], limit: 10 })).toEqual([]);
  });

  it("checks the unit scope, the period and the active period", async () => {
    expect(
      await actions().save(...as(director))({ ...draft, orgUnitId: "sekjen", version: null }),
    ).toMatchObject({ error: "forbidden" });
    const global = staff("sekre", ["finance.edit"]);
    expect(
      await actions().save(...as(global))({ ...draft, orgUnitId: "old", version: null }),
    ).toMatchObject({ error: "refused", issues: ["Choose a unit of this board period."] });
    expect(
      await actions().save(...as(global))({ ...draft, orgUnitId: "nowhere", version: null }),
    ).toMatchObject({ issues: ["Choose a unit of this board period."] });
    fake.docs.delete("settings/activePeriod");
    expect(await actions().save(...as(global))({ ...draft, version: null })).toMatchObject({
      issues: ["Activate a board period first."],
    });
  });

  it("edits only drafts, only within the editor's units, and deletes drafts softly", async () => {
    const { id } = await created();
    const save = (input: Record<string, unknown>, who = director) =>
      actions().save(...as(who))({ ...draft, id, ...input });
    expect(await save({ title: "Webinar AI 2", version: 1 })).toMatchObject({
      data: { version: 2 },
    });
    expect(await save({ orgUnitId: "sekjen", version: 2 })).toMatchObject({
      issues: ["You can only make requests for your own unit."],
    });
    expect(await save({ title: "x", version: 1 })).toMatchObject({ error: "conflict" });
    await actions().submit(...as(director))({ id, version: 2 });
    expect(await save({ title: "late", version: 3 })).toMatchObject({
      issues: ["Only drafts and returned requests can be changed."],
    });
    expect(await actions().remove(...as(director))({ id, version: 3 })).toMatchObject({
      issues: ["Only drafts and returned requests can be changed."],
    });
    const other = await created();
    expect(await actions().remove(...as(director))({ id: other.id, version: 1 })).toMatchObject({
      ok: true,
    });
    expect((await get(other.id)).deletedAt).toEqual(clock);
    expect(await store().list({ periodId: "p1", orgUnitIds: "all", limit: 10 })).toHaveLength(1);
  });
});

describe("desks and separation of duties", () => {
  it("walks submit → review → authorize → paid → done, telling the next desk each time", async () => {
    const { id } = await created();
    const run = actions();
    expect(await run.submit(...as(director))({ id, version: 1 })).toMatchObject({
      data: { status: "submitted", version: 2 },
    });
    expect(await run.review(...as(treasurer))({ id, version: 2, note: "OK" })).toMatchObject({
      data: { status: "reviewed" },
    });
    // The treasurer who reviewed cannot authorise too (koor holds both, but did not review).
    const both = staff("bendahara", ["finance.authorize"]);
    expect(await run.authorize(...as(both))({ id, version: 3, note: "" })).toMatchObject({
      error: "refused",
    });
    expect(await run.authorize(...as(coordinator))({ id, version: 3, note: "" })).toMatchObject({
      data: { status: "authorized" },
    });
    expect(steps).toEqual(["submitted", "reviewed", "authorized"]);
    expect(await get(id)).toMatchObject({
      treasurer: { uid: "bendahara", note: "OK" },
      coordinator: { uid: "koor", note: null },
    });
  });

  it("refuses the requester at every desk, and staff without the desk permission", async () => {
    const { id } = await created();
    const requesterAtDesks = staff("ari", [
      "finance.edit",
      "finance.review",
      "finance.authorize",
      "finance.pay",
    ]);
    await actions().submit(...as(director))({ id, version: 1 });
    expect(
      await actions().review(...as(requesterAtDesks))({ id, version: 2, note: "" }),
    ).toMatchObject({ issues: ["You cannot act at a desk on your own request."] });
    expect(
      await actions().returnAsTreasurer(...as(requesterAtDesks))({ id, version: 2, note: "x" }),
    ).toMatchObject({ error: "refused" });
    expect(await actions().review(...as(director))({ id, version: 2, note: "" })).toMatchObject({
      error: "forbidden",
    });
  });

  it("either desk may return (clears both desks) or reject (final)", async () => {
    const { id } = await created();
    const run = actions();
    await run.submit(...as(director))({ id, version: 1 });
    await run.review(...as(treasurer))({ id, version: 2, note: "" });
    expect(
      await run.returnAsTreasurer(...as(treasurer))({ id, version: 3, note: "x" }),
    ).toMatchObject({ issues: ["This request is not at your desk."] });
    expect(
      await run.returnAsCoordinator(...as(coordinator))({ id, version: 3, note: "Add the RAB" }),
    ).toMatchObject({ data: { status: "revision" } });
    expect(await get(id)).toMatchObject({
      treasurer: null,
      coordinator: null,
      revisionNote: "Add the RAB",
      revisionRound: 1,
    });
    await run.submit(...as(director))({ id, version: 4 });
    expect(
      await run.rejectAsTreasurer(...as(treasurer))({ id, version: 5, note: "Out of budget" }),
    ).toMatchObject({ data: { status: "rejected" } });
    expect(await run.submit(...as(director))({ id, version: 6 })).toMatchObject({
      error: "refused",
    });
    const second = await created();
    await run.submit(...as(director))({ id: second.id, version: 1 });
    await run.returnAsTreasurer(...as(treasurer))({ id: second.id, version: 2, note: "Date?" });
    await run.submit(...as(director))({ id: second.id, version: 3 });
    await run.review(...as(treasurer))({ id: second.id, version: 4, note: "" });
    expect(
      await run.rejectAsCoordinator(...as(coordinator))({ id: second.id, version: 5, note: "No" }),
    ).toMatchObject({ data: { status: "rejected" } });
    expect(steps).toEqual([
      "submitted",
      "reviewed",
      "revision",
      "submitted",
      "rejected",
      "submitted",
      "revision",
      "submitted",
      "reviewed",
      "rejected",
    ]);
  });
});

describe("documents and the proof of transfer (private PDFs, checksum on read)", () => {
  const upload = (
    id: string,
    query: string,
    body: Uint8Array = pdf,
    principal = director,
    name: string | null = encodeURIComponent("RAB Webinar.pdf"),
  ) =>
    actions().uploadFile(...as(principal))(
      id,
      new Request(`https://admin.test/api/finance/${id}/files?${query}`, {
        method: "POST",
        body,
        headers: name === null ? {} : { "x-file-name": name },
      }),
    );

  it("requires the category's documents before submit, then serves them to readers only", async () => {
    const { id } = await created({ ...draft, category: "reimbursement" });
    expect(await actions().submit(...as(director))({ id, version: 1 })).toMatchObject({
      issues: ["Complete first: Documents (proposal, budget plan or receipts)."],
    });
    const response = await upload(id, "kind=doc&version=1");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ version: 2, name: "RAB Webinar.pdf" });
    const doc = (await get(id)).documents[0];
    expect(doc).toMatchObject({ path: `finance/p1/${id}_doc_00000001.pdf`, size: pdf.length });
    const reader = staff("x", ["finance.read"]);
    const served = await actions().readFile(id, doc?.path as string, reader);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-disposition")).toBe('inline; filename="RAB-Webinar.pdf"');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(pdf);
    expect((await actions().readFile(id, "finance/other.pdf", reader)).status).toBe(404);
    expect((await actions().readFile("missing", "x", reader)).status).toBe(404);
    expect((await actions().readFile(id, doc?.path as string, null)).status).toBe(401);
    expect(
      (await actions().readFile(id, "x", staff("x", ["finance.read"], undefined, false))).status,
    ).toBe(401);
    const otherUnit = staff("y", ["finance.read"], { type: "orgUnit", orgUnitId: "sekjen" });
    expect((await actions().readFile(id, doc?.path as string, otherUnit)).status).toBe(403);
    files.set(doc?.path as string, new TextEncoder().encode("%PDF-swapped"));
    expect((await actions().readFile(id, doc?.path as string, reader)).status).toBe(404);
    expect(
      await actions().removeFile(...as(director))({ id, version: 2, path: doc?.path }),
    ).toMatchObject({ data: { version: 3 } });
    expect((await get(id)).documents).toEqual([]);
  });

  it("refuses other files, big files, unknown requests, strangers and submitted requests", async () => {
    const { id } = await created();
    const notPdf = await upload(
      id,
      "version=1",
      new TextEncoder().encode("<html>"),
      director,
      null,
    );
    expect(await notPdf.json()).toEqual({
      error: "invalid_input",
      message: "Upload the file as a PDF.",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pdf);
    expect(await (await upload(id, "version=1", big)).json()).toMatchObject({
      message: "The PDF may be at most 10 MB.",
    });
    expect((await upload(id, "version=1", pdf, director, "%E0%A4%A")).status).toBe(201);
    expect((await get(id)).documents[0]?.name).toBe("document.pdf");
    expect((await upload(id, "version=1")).status).toBe(409);
    expect((await upload("missing", "version=1")).status).toBe(403);
    const global = staff("sekre", ["finance.edit"]);
    expect(await (await upload("missing", "version=1", pdf, global)).json()).toMatchObject({
      message: "This item does not exist.",
    });
    expect((await upload(id, "version=2", pdf, staff("x", ["finance.read"]))).status).toBe(403);
    expect(
      (await upload(id, "version=2", pdf, staff("x", ["finance.edit"], undefined, false))).status,
    ).toBe(401);
    await actions().submit(...as(director))({ id, version: 2 });
    expect(await (await upload(id, "version=3")).json()).toMatchObject({
      message: "Documents change only while the request is a draft.",
    });
  });

  it("marks paid with the proof of transfer and the amount actually paid, then done", async () => {
    const { id } = await created();
    const run = actions();
    await run.submit(...as(director))({ id, version: 1 });
    // Not authorised yet: refused before anything is stored.
    expect(
      await (await upload(id, "kind=proof&version=2&amount=1", pdf, treasurer)).json(),
    ).toMatchObject({ message: "Only authorised requests can be marked paid." });
    expect(files.size).toBe(0);
    await run.review(...as(treasurer))({ id, version: 2, note: "" });
    await run.authorize(...as(coordinator))({ id, version: 3, note: "" });
    expect((await upload(id, "kind=proof&version=4&amount=0", pdf, treasurer)).status).toBe(400);
    expect((await upload(id, "kind=proof&version=4&amount=1", pdf, director)).status).toBe(403);
    const paid = await upload(id, "kind=proof&version=4&amount=149000000", pdf, treasurer);
    expect(await paid.json()).toEqual({ version: 5, status: "paid" });
    const request = await get(id);
    expect(request.payment).toMatchObject({
      uid: "bendahara",
      amountMinor: 149_000_000,
      proof: { path: `finance/p1/${id}_proof_00000001.pdf` },
    });
    const proof = await run.readFile(id, request.payment?.proof.path as string, treasurer);
    expect(proof.status).toBe(200);
    expect(await run.complete(...as(director))({ id, version: 5 })).toMatchObject({
      data: { status: "done" },
    });
    expect(steps.at(-2)).toBe("paid");
  });
});
