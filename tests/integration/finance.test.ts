import { beforeEach, describe, expect, it } from "vitest";
import { createSqlFinanceStore } from "@website/db/sql";
import type { CashEntry, FinanceRequest } from "@website/domain/finance";
import { pdfText } from "@website/pdf";
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
let exports: Record<string, unknown>[];
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
    programPeriod: (id) => {
      const program = fake.docs.get(`programs/${id}`) as { periodId: string } | undefined;
      return Promise.resolve(program?.periodId ?? null);
    },
    period: () => {
      const active = fake.docs.get("settings/activePeriod") as { periodId: string } | undefined;
      return Promise.resolve(active ? { id: active.periodId, name: "2026/2027" } : null);
    },
    logExport: (actorId, details) => {
      exports.push({ actorId, ...details });
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
  exports = [];
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
  fake.docs.set("programs/prog-1", { periodId: "p1" });
  fake.docs.set("programs/prog-old", { periodId: "p0" });
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

  it("links only a programme of the active period", async () => {
    for (const programId of ["prog-old", "nope"]) {
      expect(
        await actions().save(...as(director))({ ...draft, programId, version: null }),
      ).toMatchObject({ ok: false });
    }
    expect(await created({ ...draft, programId: null })).toMatchObject({ version: 1 });
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

describe("cash book (I2) and cash report (I3)", () => {
  const paidRequest = async (input: Record<string, unknown>, amount: number) => {
    const { id } = await created({ ...draft, ...input });
    const run = actions();
    if (input["category"] === "reimbursement" || input["category"] === "budget") {
      await actions().uploadFile(...as(director))(
        id,
        new Request(`https://admin.test/api/finance/${id}/files?kind=doc&version=1`, {
          method: "POST",
          body: pdf,
        }),
      );
    }
    let version = (await get(id)).version;
    await run.submit(...as(director))({ id, version });
    await run.review(...as(treasurer))({ id, version: version + 1, note: "" });
    await run.authorize(...as(coordinator))({ id, version: version + 2, note: "" });
    version += 3;
    const response = await run.uploadFile(...as(treasurer))(
      id,
      new Request(
        `https://admin.test/api/finance/${id}/files?kind=proof&version=${version}&amount=${amount}`,
        { method: "POST", body: pdf },
      ),
    );
    expect(response.status).toBe(201);
    return id;
  };
  const entries = () =>
    [...fake.docs.entries()]
      .filter(([key]) => key.startsWith("cashEntries/"))
      .map(([key, value]) => ({ key, ...(value as Omit<CashEntry, "id">) }));
  const cashier = staff("tina", ["finance.cashbook", "finance.export"]);

  it("mark paid writes cashEntries/{requestId} in the same transaction, exactly once", async () => {
    const id = await paidRequest({}, 149_000_000);
    expect(entries()).toMatchObject([
      {
        key: `cashEntries/${id}`,
        kind: "out",
        category: "disbursement",
        amountMinor: 149_000_000,
        currency: "IDR",
        source: "request",
        requestId: id,
        date: "2026-11-04",
      },
    ]);
    const audit = [...fake.docs.values()].filter(
      (v) => (v as { resourceType?: string }).resourceType === "cashEntry",
    );
    expect(audit).toHaveLength(1);
    // A second payment of the same request is refused: the line is never written twice.
    const again = await actions().uploadFile(...as(treasurer))(
      id,
      new Request(`https://admin.test/api/finance/${id}/files?kind=proof&version=5&amount=1`, {
        method: "POST",
        body: pdf,
      }),
    );
    expect(again.status).toBe(400);
    expect(entries()).toHaveLength(1);
  });

  it("a stale version or an existing line refuses the payment as a whole", async () => {
    const id = await paidRequest({}, 1);
    const request = await get(id);
    // Simulate a line already present (e.g. imported) for a request being paid now.
    fake.docs.set(`financeRequests/${id}`, {
      ...(fake.docs.get(`financeRequests/${id}`) as object),
      status: "authorized",
      payment: null,
    });
    const run = actions();
    expect(
      await (
        await run.uploadFile(...as(treasurer))(
          id,
          new Request(
            `https://admin.test/api/finance/${id}/files?kind=proof&version=${request.version}&amount=5`,
            { method: "POST", body: pdf },
          ),
        )
      ).json(),
    ).toMatchObject({ message: "This request is already in the cash book." });
    expect(
      (
        await run.uploadFile(...as(treasurer))(
          id,
          new Request(`https://admin.test/api/finance/${id}/files?kind=proof&version=1&amount=5`, {
            method: "POST",
            body: pdf,
          }),
        )
      ).status,
    ).toBe(409);
    expect(entries()).toHaveLength(1);
  });

  it("the store refuses to pay a request that does not exist", async () => {
    const never = () => {
      throw new Error("not called");
    };
    await expect(store().pay("missing", 1, (r) => r, never, never, clock)).rejects.toThrow(
      "This item does not exist.",
    );
  });

  it("budget requests are paid without any cash book line", async () => {
    await paidRequest({ category: "budget" }, 10);
    expect(entries()).toEqual([]);
  });

  it("manual entries need finance.cashbook (global) and a unit of the period", async () => {
    const input = {
      date: "2026-11-01",
      kind: "in",
      category: "opening_balance",
      description: "Saldo awal",
      amountMinor: 500_000_000,
      currency: "IDR",
    };
    expect(await actions().addCashEntry(...as(cashier))(input)).toMatchObject({ ok: true });
    expect(entries()).toMatchObject([{ source: "manual", createdBy: "tina", requestId: null }]);
    const unitScoped = staff("u", ["finance.cashbook"], { type: "orgUnit", orgUnitId: "media" });
    expect(await actions().addCashEntry(...as(unitScoped))(input)).toMatchObject({
      error: "forbidden",
    });
    expect(
      await actions().addCashEntry(...as(cashier))({ ...input, orgUnitId: "old" }),
    ).toMatchObject({ issues: ["Choose a unit of this board period."] });
    expect(
      await actions().addCashEntry(...as(cashier))({ ...input, orgUnitId: "media" }),
    ).toMatchObject({ ok: true });
    fake.docs.delete("settings/activePeriod");
    expect(await actions().addCashEntry(...as(cashier))(input)).toMatchObject({
      issues: ["Activate a board period first."],
    });
  });

  const report = (query: string, principal: Principal | null = cashier) =>
    actions().reportFile(new URL(`https://admin.test/api/finance/report?${query}`), principal);

  it("recomputes the report on the server: balance per currency, range filtering, CSV", async () => {
    await actions().addCashEntry(...as(cashier))({
      date: "2026-10-30",
      kind: "in",
      category: "opening_balance",
      description: "=HYPERLINK(1)",
      amountMinor: 200_000_000,
      currency: "IDR",
    });
    await actions().addCashEntry(...as(cashier))({
      date: "2026-11-01",
      kind: "in",
      category: "dues",
      description: 'Iuran "Jepang"',
      amountMinor: 30000,
      currency: "JPY",
    });
    await paidRequest({}, 50_000_000);
    const csv = await report("from=2026-11-01&to=2026-11-30&format=csv");
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toBe(
      'attachment; filename="cash-report-2026-11-01-2026-11-30.csv"',
    );
    const lines = (await csv.text())
      .replace(/^\ufeff/, "")
      .trim()
      .split("\r\n");
    expect(lines).toEqual([
      "currency,date,kind,category,description,in,out,balance,source",
      'IDR,2026-11-01,opening,,"Opening balance",,,2000000.00,',
      'IDR,2026-11-04,out,disbursement,"Webinar AI",,500000.00,1500000.00,request',
      'IDR,2026-11-30,closing,,"Closing balance",0.00,500000.00,1500000.00,',
      'JPY,2026-11-01,opening,,"Opening balance",,,0,',
      'JPY,2026-11-01,in,dues,"Iuran ""Jepang""",30000,,30000,manual',
      'JPY,2026-11-30,closing,,"Closing balance",30000,0,30000,',
    ]);
    const all = await (await report("format=csv")).text();
    expect(all).toContain(`"'=HYPERLINK(1)"`);
    expect(exports).toMatchObject([
      { actorId: "tina", dataset: "cash_report", format: "csv", from: "2026-11-01" },
      { format: "csv", from: null, to: null },
    ]);
  });

  it("renders the same report as PDF, and refuses bad ranges, strangers and no period", async () => {
    await paidRequest({}, 50_000_000);
    await actions().addCashEntry(...as(cashier))({
      date: "2026-11-02",
      kind: "in",
      category: "donation",
      description: "Donasi alumni",
      amountMinor: 10_000_000,
      currency: "IDR",
    });
    const whole = await pdfText(new Uint8Array(await (await report("format=pdf")).arrayBuffer()));
    expect(whole).toContain("start – today");
    expect(whole).toContain("Donation / sponsor");
    const pdfResponse = await report("from=2026-11-01&to=2026-11-04&format=pdf");
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    const text = await pdfText(new Uint8Array(await pdfResponse.arrayBuffer()));
    expect(text).toContain("Webinar AI");
    expect(text).toContain("IDR -400,000.00");
    expect(text).toContain("2026-11-01 – 2026-11-04");
    expect((await report("from=2026-12-01&to=2026-11-01")).status).toBe(400);
    expect((await report("from=yesterday")).status).toBe(400);
    expect((await report("format=csv", null)).status).toBe(401);
    expect((await report("format=csv", staff("x", ["finance.read"]))).status).toBe(403);
    const unitScoped = staff("u", ["finance.export"], { type: "orgUnit", orgUnitId: "media" });
    expect((await report("format=csv", unitScoped)).status).toBe(403);
    fake.docs.delete("settings/activePeriod");
    expect((await report("format=pdf")).status).toBe(404);
  });
});
