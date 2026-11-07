import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_COLOR, PAGE_PERMISSIONS, ROLE_COLORS } from "@website/permissions";
import {
  filterPermissionGroups,
  inviteRow,
  joinPermissions,
  matchesPerson,
  matchesRole,
  permissionGroups,
  personRow,
  personSortValue,
  roleInk,
  roleTabs,
  splitPermissions,
} from "../../apps/admin/src/components/role-manager-model";

const global = { type: "global" } as const;
const account = (over: Record<string, unknown> = {}) => ({
  uid: "ana",
  email: "ana@example.org",
  name: "Ana Putri",
  status: "active" as const,
  version: 3,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  lastSignInAt: null,
  roleAssignments: [
    { roleId: "visitor", scope: global },
    { roleId: "bph", scope: global, periodId: null, source: "manual" as const, revokedAt: null },
    { roleId: "it", scope: { type: "chapter", chapterId: "jp" } as const },
    { roleId: "old", scope: global, revokedAt: new Date("2026-01-01T00:00:00Z") },
    {
      roleId: "head",
      scope: { type: "orgUnit", orgUnitId: "media" } as const,
      source: "appointment" as const,
      periodId: "p2026",
    },
  ],
  ...over,
});

describe("Role Manager people rows", () => {
  it("shows the name (or the e-mail), the website role and, apart, the organizational roles", () => {
    expect(personRow(account())).toEqual({
      id: "ana",
      uid: "ana",
      name: "Ana Putri",
      email: "ana@example.org",
      status: "active",
      version: 3,
      createdAt: "2026-10-01T00:00:00.000Z",
      lastSignInAt: null,
      roleId: "bph",
      // Chapter / unit / period roles and appointment roles are changed where they come from.
      orgRoleIds: ["it", "head"],
    });
    expect(personRow(account({ name: null })).name).toBe("ana@example.org");
    expect(personRow(account({ name: null, email: null })).name).toBe("ana");
    expect(
      personRow(account({ roleAssignments: [{ roleId: "visitor", scope: global }] })),
    ).toMatchObject({ roleId: null, orgRoleIds: [] });
  });

  it("turns a pending invite into an 'invited' row", () => {
    expect(
      inviteRow({ email: "new@example.org", roleIds: ["bph"], createdAt: null }),
    ).toMatchObject({
      id: "invite:new@example.org",
      uid: null,
      name: "new@example.org",
      status: "invited",
      roleId: "bph",
      orgRoleIds: [],
    });
  });

  it("filters by website role tab and search (name or e-mail), and counts the tabs", () => {
    const rows = [
      personRow(account()),
      personRow(account({ uid: "budi", name: "Budi", email: "b@x.org", status: "inactive" })),
      inviteRow({ email: "cici@x.org", roleIds: ["it"], createdAt: null }),
    ];
    const pick = (tab: string, query: string) =>
      rows.filter((r) => matchesPerson(r, { tab, query })).map((r) => r.id);
    expect(pick("all", "")).toEqual(["ana", "budi", "invite:cici@x.org"]);
    expect(pick("it", "")).toEqual(["invite:cici@x.org"]);
    expect(pick("bph", "budi")).toEqual(["budi"]);
    expect(pick("all", "  PUTRI ")).toEqual(["ana"]);
    expect(pick("all", "b@x")).toEqual(["budi"]);
    const roles = [
      { id: "superadmin", name: "Superadmin" },
      { id: "visitor", name: "Visitor" },
      { id: "bph", name: "BPH" },
      { id: "it", name: "IT" },
      { id: "head", name: "Head" },
    ];
    // Roles nobody holds as website role get no tab; the default role never does.
    expect(roleTabs(rows, roles)).toEqual([
      { key: "all", label: "All", count: 3 },
      { key: "bph", label: "BPH", count: 2 },
      { key: "it", label: "IT", count: 1 },
    ]);
  });

  it("sorts by name, role name, status and last sign-in (never signed in first)", () => {
    const names = new Map([["bph", "BPH"]]);
    const row = personRow(account());
    expect(personSortValue(row, "name", names)).toBe("ana putri");
    expect(personSortValue(row, "role", names)).toBe("bph");
    expect(personSortValue({ ...row, roleId: null }, "role", names)).toBe("");
    expect(personSortValue({ ...row, roleId: "gone" }, "role", names)).toBe("gone");
    expect(personSortValue(row, "status", names)).toBe("active");
    expect(personSortValue(row, "lastSignIn", names)).toBe("");
    expect(
      personSortValue({ ...row, lastSignInAt: "2026-11-01T08:00:00.000Z" }, "lastSignIn", names),
    ).toBe("2026-11-01T08:00:00.000Z");
  });
});

describe("Role Manager roles", () => {
  it("picks the text colour with the higher contrast on the badge colour (WCAG)", () => {
    expect(roleInk("#F5A623")).toBe("dark");
    expect(roleInk("#D4B25A")).toBe("dark");
    // 5.3:1 with dark text, 4.0:1 with white.
    expect(roleInk("#D9534F")).toBe("dark");
    expect(roleInk("#123D5E")).toBe("light");
    for (const color of ROLE_COLORS) expect(["dark", "light"]).toContain(roleInk(color));
    expect(roleInk(DEFAULT_ROLE_COLOR)).toBe("light");
  });

  it("searches roles by name or permission", () => {
    const role = {
      id: "pub",
      name: "Publikasi",
      permissions: ["articles.publish", "articles.read"],
    };
    expect(matchesRole(role, "")).toBe(true);
    expect(matchesRole(role, "publik")).toBe(true);
    expect(matchesRole(role, "ARTICLES.PUB")).toBe(true);
    expect(matchesRole(role, "events")).toBe(false);
  });

  it("groups the permissions per admin page: the page, then Read, Edit and its extras", () => {
    const groups = permissionGroups();
    expect(groups.find((g) => g.page === "audit")).toEqual({
      page: "audit",
      label: "Audit Log",
      permissions: [
        { value: "audit.read", label: "Audit Read" },
        { value: "audit.edit", label: "Audit Edit" },
        { value: "audit.revert", label: "Audit Revert" },
      ],
    });
    expect(groups.find((g) => g.page === "shop_orders")?.permissions.at(-1)).toEqual({
      value: "shop_orders.refund",
      label: "Shop Orders Refund",
    });
    // Every permission is in exactly one group.
    expect(groups.flatMap((g) => g.permissions.map((p) => p.value))).toEqual(
      expect.arrayContaining([...PAGE_PERMISSIONS]),
    );
    expect(groups.flatMap((g) => g.permissions)).toHaveLength(PAGE_PERMISSIONS.length);
  });

  it("opens a role with whole pages ticked where it has all of a page, single permissions elsewhere", () => {
    const { pages, single } = splitPermissions([
      "audit.read",
      "audit.edit",
      "audit.revert",
      "tools.read",
      "unknown.read",
    ]);
    expect([...pages]).toEqual(["audit"]);
    expect([...single]).toEqual(["tools.read"]);
    expect(joinPermissions(pages, single).sort()).toEqual([
      "audit.edit",
      "audit.read",
      "audit.revert",
      "tools.read",
    ]);
    expect(joinPermissions(new Set(), new Set())).toEqual([]);
  });

  it("searches the permission dropdown: a matching page keeps all its permissions", () => {
    const groups = permissionGroups();
    const pages = (query: string) =>
      filterPermissionGroups(groups, query).map((g) => [g.page, g.permissions.length]);
    expect(filterPermissionGroups(groups, "  ")).toEqual(groups);
    // "audit log" matches the page label: Read, Edit and Revert stay.
    expect(pages("AUDIT LOG")).toEqual([["audit", 3]]);
    // "revert" matches one permission only.
    expect(pages("revert")).toEqual([["audit", 1]]);
    expect(pages("shop_orders.refund")).toEqual([["shop_orders", 1]]);
    expect(pages("nothing like this")).toEqual([]);
  });
});
