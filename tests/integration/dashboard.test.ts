import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createSqlDashboardCounts } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createDashboard } from "../../apps/admin/src/server/dashboard";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlDashboardCounts>[0];
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "u",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
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
  });
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
});
