import { describe, expect, it } from "vitest";
import type { PeriodReportCard } from "@website/domain/programs";
import type { ReportPdfInput } from "@website/pdf";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createExportLog, createReportCardFileRoute } from "../../apps/admin/src/server/exports";

const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "u1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "orgUnit", orgUnitId: "media" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const as = (p: Principal) => [() => Promise.resolve(p)] as const;

const card: PeriodReportCard = {
  okr: {
    achievementPercent: 40,
    objectives: [{ id: "o1", title: "Grow", orgUnitId: "media", percent: 40, keyResults: 2 }],
  },
  programmes: {
    counts: { proposed: 1, approved: 0, running: 2, finished: 1, cancelled: 0 },
    total: 4,
    troubled: 1,
    completionPercent: 33,
  },
  budget: [
    {
      currency: "JPY",
      planned: { currency: "JPY", amountMinor: 100000 },
      realized: { currency: "JPY", amountMinor: 50000 },
      absorptionPercent: 50,
    },
  ],
  lpj: { submitted: 1, approved: 2, overdue: 3 },
};

describe("report card PDF (M8)", () => {
  it("renders the period's card for programme readers only", async () => {
    let sheet: ReportPdfInput | null = null;
    const route = createReportCardFileRoute({
      periods: () =>
        Promise.resolve([
          { id: "p0", name: "2025", status: "archived" },
          { id: "p1", name: "2026", status: "active" },
        ]),
      card: () => Promise.resolve(card),
      units: () => Promise.resolve([{ id: "media", name: "Media" }]),
      render: (input) => {
        sheet = input;
        return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
      },
      now: () => new Date("2026-11-10T12:00:00Z"),
    });
    expect((await route(null, null)).status).toBe(401);
    expect((await route(null, staff(["events.read"]))).status).toBe(403);
    const response = await route(null, staff(["programs.read"]));
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(sheet).toMatchObject({ title: "Rapor periode / Report card: 2026" });
    const text = JSON.stringify(sheet);
    expect(text).toContain("OKR achievement: 40%");
    expect(text).toContain("JPY: planned");
    expect(text).toContain("Grow (Media): 40%");
    expect(text).toContain("overdue: 3");
  });
});

describe("export log (M8)", () => {
  it("logs exports of personal data as data.export events, with the page permission", async () => {
    const logged: unknown[] = [];
    const log = createExportLog({
      logExport: (actorId, details) => logged.push({ actorId, details }),
    });
    expect(await log.applicants(...as(staff(["events.read"])))({ rows: 3 })).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await log.applicants(...as(staff(["recruitment.read"])))({ rows: 3 })).toEqual({
      ok: true,
      data: null,
    });
    await log.attendance(...as(staff(["meetings.read"])))({ rows: 5 });
    await log.people(...as(staff(["users.read"])))({ rows: 9 });
    expect(logged).toEqual([
      { actorId: "u1", details: { dataset: "applicants", rows: 3 } },
      { actorId: "u1", details: { dataset: "meeting_attendance", rows: 5 } },
      { actorId: "u1", details: { dataset: "accounts", rows: 9 } },
    ]);
  });
});
