import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { createFirestoreDashboardCounts } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createDashboard } from "../../apps/admin/src/server/dashboard";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreDashboardCounts>[0];
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
  const fake = fakeFirestore();
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
    counts: createFirestoreDashboardCounts(fake.db as unknown as Db),
    listAudit,
    graduatedOfficers: () =>
      Promise.resolve([
        { name: "Siti", title: "Staf", graduatedOn: "2026-09-30", periodId: "p2026" },
      ]),
  });

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
    });
    expect((await dashboard(staff(["appointments.edit"]))).graduatedOfficers).toEqual([
      { name: "Siti", title: "Staf", graduatedOn: "2026-09-30", periodId: "p2026" },
    ]);
  });
});
