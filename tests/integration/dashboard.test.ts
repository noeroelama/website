import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createSqlDashboardCounts } from "@website/db/sql";
import type { FinanceRequest } from "@website/domain/finance";
import type { LpjReport, Program } from "@website/domain/programs";
import type { CalendarItem, Task } from "@website/domain/tasks";
import type { ZoomRequest } from "@website/domain/zoom";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createDashboard } from "../../apps/admin/src/server/dashboard";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlDashboardCounts>[0];
const staff = (permissions: string[], scope: Scope = { type: "global" }): Principal => ({
  kind: "user",
  userId: "u",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope,
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});

describe("admin dashboard overview", () => {
  const fake = fakeDb();
  for (const [path, data] of [
    ["events/e1", { deletedAt: null }],
    ["events/e2", { deletedAt: new Date() }],
    ["galleries/a1", { deletedAt: null }],
    ["content/n1", { kind: "news", deletedAt: null }],
    ["content/n2", { kind: "news", deletedAt: null }],
    ["content/p1", { kind: "page", deletedAt: null }],
    ["subscribers/s1", { status: "confirmed" }],
    ["subscribers/s2", { status: "pending" }],
  ] as const) {
    fake.docs.set(path, data);
  }
  const listAudit = (query: { limit: number }) =>
    Promise.resolve({
      items: Array.from({ length: query.limit }, (_, i) => ({ id: `a${i}` }) as AuditEvent),
      nextCursor: null,
    });
  const dashboard = createDashboard({
    counts: createSqlDashboardCounts(fake.db as unknown as Db),
    listAudit,
    graduatedOfficers: () =>
      Promise.resolve([
        { name: "Siti", title: "Staf", graduatedOn: "2026-09-30", periodId: "p2026" },
      ]),
    lpjSecretariatHolders: () => Promise.resolve(secretariatHolders),
    activePeriod: () => Promise.resolve(period),
    finance: () => Promise.resolve(finance),
    lpj: () => Promise.resolve(lpj),
    programs: () => Promise.resolve(programs),
    zoom: () => Promise.resolve(zoom),
    agenda: (_p, from, to) =>
      Promise.resolve([
        { id: "meeting:a", title: `${from.toISOString()}..${to.toISOString()}` } as CalendarItem,
      ]),
    myTasks: () => Promise.resolve(tasks),
    now: () => now,
  });
  let period: { id: string; name: string } | null = null;
  let secretariatHolders = 0;

  it("counts live records, and only for pages the viewer can read", async () => {
    const everything = await dashboard(
      staff(["events.read", "gallery.read", "articles.read", "newsletter.read", "audit.read"]),
    );
    expect(everything.counters.map((c) => [c.key, c.value])).toEqual([
      ["events", 1],
      ["albums", 1],
      ["articles", 2],
      ["subscribers", 1],
    ]);
    expect(everything.audit).toHaveLength(10);

    const editor = await dashboard(staff(["articles.edit"]));
    expect(editor.counters.map((c) => c.key)).toEqual(["articles"]);
    expect(editor.audit).toBeNull();

    expect(await dashboard(staff([]))).toEqual({
      counters: [],
      audit: null,
      graduatedOfficers: null,
      noLpjSecretariat: false,
      queues: [],
      agenda: null,
      deadlines: tasks.slice(0, 2),
      period: null,
    });
    expect((await dashboard(staff(["appointments.edit"]))).graduatedOfficers).toEqual([
      { name: "Siti", title: "Staf", graduatedOn: "2026-09-30", periodId: "p2026" },
    ]);
  });

  it("warns LPJ desks, approvers and role editors when nobody holds the secretariat desk", async () => {
    for (const permissions of [["lpj.read"], ["programs.approve"], ["roles.edit"]]) {
      expect((await dashboard(staff(permissions))).noLpjSecretariat).toBe(true);
    }
    expect((await dashboard(staff(["events.read"]))).noLpjSecretariat).toBe(false);
    secretariatHolders = 1;
    expect((await dashboard(staff(["lpj.read"]))).noLpjSecretariat).toBe(false);
  });

  it("queues count only what waits at my desks, in my units, that the module would let me do", async () => {
    period = { id: "p1", name: "2026" };
    const desks = [
      "finance.review",
      "finance.authorize",
      "finance.pay",
      "lpj.review_secretariat",
      "lpj.review_treasurer",
      "lpj.approve",
      "zoom.approve",
    ];
    const counts = async (principal: Principal) =>
      (await dashboard(principal)).queues.map((q) => [q.label, q.count]);
    expect(await counts(staff(desks))).toEqual([
      ["Finance requests to review", 2],
      ["Finance requests to authorise", 1],
      ["Finance requests to pay", 1],
      ["LPJs to check (secretariat)", 1],
      ["LPJs to check (treasurer)", 1],
      ["LPJs to approve", 1],
      ["Zoom bookings to approve", 1],
    ]);
    expect(await counts(staff(desks, { type: "orgUnit", orgUnitId: "other" }))).toEqual([
      ["Finance requests to review", 1],
      ["Finance requests to authorise", 0],
      ["Finance requests to pay", 0],
      ["LPJs to check (secretariat)", 0],
      ["LPJs to check (treasurer)", 0],
      ["LPJs to approve", 0],
      ["Zoom bookings to approve", 0],
    ]);
    expect(await counts(staff(["finance.read", "lpj.read"]))).toEqual([]);
    period = null;
    expect(await counts(staff(["finance.review", "zoom.approve"]))).toEqual([
      ["Finance requests to review", 0],
      ["Zoom bookings to approve", 1],
    ]);
  });

  it("agenda for 7 days, deadlines within 2 weeks (overdue included), period numbers in scope", async () => {
    period = { id: "p1", name: "2026" };
    const view = await dashboard(
      staff(["calendar.read", "programs.read"], { type: "orgUnit", orgUnitId: "media" }),
    );
    expect(view.agenda?.[0]?.title).toBe("2026-11-05T00:00:00.000Z..2026-11-12T00:00:00.000Z");
    expect(view.deadlines.map((t) => t.id)).toEqual(["old", "soon"]);
    expect(view.period).toEqual({ name: "2026", programs: 2, running: 1 });
    period = null;
    expect((await dashboard(staff(["programs.read"]))).period).toBeNull();
  });
});

const now = new Date("2026-11-05T00:00:00Z");
const media = ["dirs", "media"];
const other = ["other"];
const finance = [
  { id: "f1", status: "submitted", createdBy: "x", orgUnitPath: media },
  { id: "f2", status: "submitted", createdBy: "u", orgUnitPath: media },
  { id: "f3", status: "submitted", createdBy: "x", orgUnitPath: other },
  { id: "f4", status: "reviewed", createdBy: "x", treasurer: { uid: "y" }, orgUnitPath: media },
  { id: "f5", status: "reviewed", createdBy: "x", treasurer: { uid: "u" }, orgUnitPath: media },
  { id: "f6", status: "authorized", createdBy: "x", orgUnitPath: media },
] as unknown as FinanceRequest[];
const lpjOf = (id: string, extra: object) =>
  ({
    id,
    status: "submitted",
    submittedBy: "x",
    realized: {},
    secretariat: null,
    treasurer: null,
    approval: null,
    orgUnitPath: media,
    ...extra,
  }) as unknown as LpjReport;
const lpj = [
  lpjOf("l1", {}),
  lpjOf("l2", { submittedBy: "u" }),
  lpjOf("l3", { secretariat: { uid: "y" }, treasurer: { uid: "z" } }),
  lpjOf("l4", { status: "draft" }),
];
const zoom = [
  { id: "z1", status: "pending", startsAt: new Date("2026-11-06T00:00:00Z"), orgUnitPath: media },
  { id: "z2", status: "pending", startsAt: new Date("2026-11-04T00:00:00Z"), orgUnitPath: media },
  { id: "z3", status: "approved", startsAt: new Date("2026-11-06T00:00:00Z"), orgUnitPath: media },
] as unknown as ZoomRequest[];
const programs = [
  { id: "p1", status: "running", orgUnitPath: media },
  { id: "p2", status: "approved", orgUnitPath: media },
  { id: "p3", status: "running", orgUnitPath: other },
] as unknown as Program[];
const task = (id: string, due: string | null, done = false) =>
  ({ id, due, done, overdue: due !== null && due < "2026-11-05" }) as Task;
const tasks = [
  task("old", "2026-10-01"),
  task("soon", "2026-11-19"),
  task("later", "2026-11-20"),
  task("none", null),
  task("done", "2026-11-06", true),
];
