import { describe, expect, it } from "vitest";
import { hasTwoSignInMethods } from "@website/auth";
import {
  accountChangeRefusal,
  ADMIN_PAGES,
  can,
  canAccessAdmin,
  canAppointInto,
  canAssignRole,
  canDeleteRole,
  canInSomeScope,
  canSaveRole,
  DEFAULT_ROLE_ASSIGNMENTS,
  isPagePermission,
  normalizePermissions,
  PAGE_PERMISSIONS,
  requirePermission,
  resolveAssignments,
  scopedChapterIds,
  SUPERADMIN_ROLE_ID,
  SYSTEM_ROLES,
  type Principal,
  type RoleDefinition,
  type Scope,
} from "@website/permissions";

const global: Scope = { type: "global" };
const jp: Scope = { type: "chapter", chapterId: "jp" };

/** Custom roles as an admin would create them in the Roles page. */
const roles: RoleDefinition[] = [
  {
    id: "editor",
    name: "Editor",
    permissions: normalizePermissions(["articles.publish", "gallery.edit"]),
  },
  {
    id: "viewer",
    name: "Viewer",
    permissions: normalizePermissions(["articles.read", "events.read"]),
  },
  {
    id: "chapter_admin",
    name: "Chapter admin",
    permissions: normalizePermissions(["members.pii", "events.edit"]),
  },
  {
    id: "role_manager",
    name: "Role manager",
    permissions: normalizePermissions(["roles.edit", "users.edit", "articles.edit"]),
  },
  { id: "everything", name: "Everything", permissions: [...PAGE_PERMISSIONS] },
  { id: "nothing", name: "No pages", permissions: [] },
];
const lookup = new Map(roles.map((role) => [role.id, role]));

const principal = (assignments: { roleId: string; scope?: Scope }[], active = true): Principal => ({
  kind: "user",
  userId: "u1",
  active,
  assignments: resolveAssignments(
    assignments.map((a) => ({ roleId: a.roleId, scope: a.scope ?? global })),
    lookup,
  ),
});
const role = (id: string): RoleDefinition =>
  lookup.get(id) ?? SYSTEM_ROLES[id as keyof typeof SYSTEM_ROLES];

describe("admin page catalogue", () => {
  it("gives every page a read and an edit permission, plus its named extras", () => {
    for (const [page, definition] of Object.entries(ADMIN_PAGES)) {
      expect(PAGE_PERMISSIONS).toContain(`${page}.read`);
      expect(PAGE_PERMISSIONS).toContain(`${page}.edit`);
      for (const extra of Object.keys("extras" in definition ? definition.extras : {})) {
        expect(PAGE_PERMISSIONS).toContain(`${page}.${extra}`);
      }
    }
    expect(new Set(PAGE_PERMISSIONS).size).toBe(PAGE_PERMISSIONS.length);
    expect(PAGE_PERMISSIONS).toContain("members.pii");
    expect(PAGE_PERMISSIONS).not.toContain("events.pii");
  });

  it("recognises only catalogue permissions", () => {
    expect(isPagePermission("audit.revert")).toBe(true);
    expect(isPagePermission("audit.delete")).toBe(false);
    expect(isPagePermission("profile.read_own")).toBe(false);
  });

  it("normalises a role: edit and extras include read; unknown and self-service entries are dropped", () => {
    expect(normalizePermissions(["articles.publish", "gallery.edit"]).sort()).toEqual([
      "articles.publish",
      "articles.read",
      "gallery.edit",
      "gallery.read",
    ]);
    expect(normalizePermissions(["profile.write_own", "bogus.read", "__proto__"])).toEqual([]);
  });
});

describe("resolving role assignments", () => {
  it("system roles always come from code; a stored role named like one is ignored", () => {
    const fake = new Map([
      [SUPERADMIN_ROLE_ID, { id: SUPERADMIN_ROLE_ID, name: "x", permissions: [] }],
    ]);
    const [resolved] = resolveAssignments([{ roleId: SUPERADMIN_ROLE_ID, scope: global }], fake);
    expect(resolved?.permissions.size).toBe(PAGE_PERMISSIONS.length);
  });

  it("drops assignments whose role no longer exists (fail closed)", () => {
    expect(resolveAssignments([{ roleId: "deleted-role", scope: global }], lookup)).toEqual([]);
  });

  it("keeps only live assignments: revoked ones and other periods are ignored (B6)", () => {
    const stored = [
      {
        roleId: "editor",
        scope: global,
        periodId: null,
        source: "manual" as const,
        revokedAt: null,
      },
      {
        roleId: "viewer",
        scope: global,
        periodId: "2026",
        source: "appointment" as const,
        revokedAt: null,
      },
      {
        roleId: "chapter_admin",
        scope: jp,
        periodId: "2025",
        source: "appointment" as const,
        revokedAt: null,
      },
      {
        roleId: "role_manager",
        scope: global,
        periodId: null,
        source: "manual" as const,
        revokedAt: new Date(),
      },
    ];
    expect(resolveAssignments(stored, lookup, "2026").map((a) => a.roleId)).toEqual([
      "editor",
      "viewer",
    ]);
    // No active period: only period-independent assignments count.
    expect(resolveAssignments(stored, lookup, null).map((a) => a.roleId)).toEqual(["editor"]);
  });

  it("new accounts get the user role, which opens no admin page", () => {
    const fresh: Principal = {
      kind: "user",
      userId: "u1",
      active: true,
      assignments: resolveAssignments(DEFAULT_ROLE_ASSIGNMENTS, lookup),
    };
    expect(canAccessAdmin(fresh)).toBe(false);
  });
});

describe("can()", () => {
  it("denies by default and for null/inactive principals", () => {
    expect(can(null, "events.read")).toBe(false);
    expect(can(principal([{ roleId: SUPERADMIN_ROLE_ID }], false), "events.read")).toBe(false);
    expect(can(principal([]), "events.read")).toBe(false);
  });

  it("grants what the role was given in the admin panel, nothing more", () => {
    const editor = principal([{ roleId: "editor" }]);
    expect(can(editor, "articles.publish")).toBe(true);
    expect(can(editor, "articles.read")).toBe(true);
    expect(can(editor, "articles.edit")).toBe(false);
    expect(can(editor, "members.pii")).toBe(false);
    expect(can(editor, "roles.edit")).toBe(false);
  });

  it("scopes chapter assignments to their chapter", () => {
    const admin = principal([{ roleId: "chapter_admin", scope: jp }]);
    expect(can(admin, "members.pii", { chapterId: "jp" })).toBe(true);
    expect(can(admin, "members.pii", { chapterId: "au" })).toBe(false);
    expect(can(admin, "members.pii")).toBe(false);
  });

  it("org unit assignments cover the unit and its descendants, never siblings (DEC-2)", () => {
    const director = principal([
      { roleId: "chapter_admin", scope: { type: "orgUnit", orgUnitId: "dir-edu" } },
    ]);
    // orgUnitPath = the resource's unit + its ancestors (root first).
    expect(can(director, "events.edit", { orgUnitPath: ["root", "dir-edu"] })).toBe(true);
    expect(can(director, "events.edit", { orgUnitPath: ["root", "dir-edu", "div-lang"] })).toBe(
      true,
    );
    expect(can(director, "events.edit", { orgUnitPath: ["root", "dir-media"] })).toBe(false);
    expect(can(director, "events.edit", { orgUnitPath: ["root"] })).toBe(false);
    expect(can(director, "events.edit")).toBe(false);
    expect(can(director, "events.edit", { chapterId: "dir-edu" })).toBe(false);
  });

  it("lists are filtered to the chapters a principal covers; global means every chapter (A2)", () => {
    const twoChapters = principal([
      { roleId: "chapter_admin", scope: jp },
      { roleId: "chapter_admin", scope: { type: "chapter", chapterId: "kr" } },
      { roleId: "viewer", scope: { type: "orgUnit", orgUnitId: "media" } },
    ]);
    expect(scopedChapterIds(twoChapters, "events.edit")).toEqual(["jp", "kr"]);
    expect(scopedChapterIds(twoChapters, "gallery.read")).toEqual([]);
    expect(scopedChapterIds(twoChapters, "articles.read")).toEqual([]); // unit scope: no chapter
    const national = principal([
      { roleId: "chapter_admin", scope: jp },
      { roleId: "chapter_admin" },
    ]);
    expect(scopedChapterIds(national, "events.edit")).toBe("all");
    expect(scopedChapterIds(principal([{ roleId: "everything" }], false), "events.edit")).toEqual(
      [],
    );
    expect(scopedChapterIds(null, "events.edit")).toEqual([]);
  });

  it("appointing gives only roles whose permissions the appointer holds, never built-in ones (B7)", () => {
    const secretary: RoleDefinition = {
      id: "secretary_general",
      name: "Sekjen",
      permissions: normalizePermissions(["appointments.edit", "events.edit"]),
    };
    const officer: RoleDefinition = {
      id: "officer",
      name: "Officer",
      permissions: normalizePermissions(["events.read"]),
    };
    const director: RoleDefinition = {
      id: "director",
      name: "Director",
      permissions: normalizePermissions(["gallery.edit"]),
    };
    lookup.set(secretary.id, secretary);
    const sekjen = principal([{ roleId: "secretary_general" }]);
    expect(canAppointInto(sekjen, officer)).toBe(true);
    expect(canAppointInto(sekjen, director)).toBe(false);
    expect(canAppointInto(sekjen, { id: "superadmin", name: "x", permissions: [] })).toBe(false);
    expect(canAppointInto(principal([{ roleId: "viewer" }]), officer)).toBe(false);
    lookup.delete(secretary.id);
  });

  it("*_own permissions belong to every active account, for its own resources only", () => {
    const user = principal([]);
    expect(can(user, "profile.write_own", { ownerId: "u1" })).toBe(true);
    expect(can(user, "profile.write_own", { ownerId: "someone-else" })).toBe(false);
    expect(can(user, "profile.write_own")).toBe(false);
    const superadmin = principal([{ roleId: SUPERADMIN_ROLE_ID }]);
    expect(can(superadmin, "profile.write_own", { ownerId: "x" })).toBe(false);
  });

  it("requirePermission throws for a missing permission", () => {
    expect(() => requirePermission(principal([{ roleId: "viewer" }]), "articles.publish")).toThrow(
      /Missing permission/,
    );
  });

  it("canAccessAdmin needs at least one admin-page permission", () => {
    expect(canAccessAdmin(principal([{ roleId: "viewer" }]))).toBe(true);
    expect(canAccessAdmin(principal([{ roleId: "nothing" }]))).toBe(false);
    expect(canAccessAdmin(principal([{ roleId: "member" }]))).toBe(false);
    expect(canAccessAdmin(null)).toBe(false);
  });

  it("canInSomeScope ignores the resource scope (navigation), but never inactive principals", () => {
    const admin = principal([{ roleId: "chapter_admin", scope: jp }]);
    expect(can(admin, "events.edit")).toBe(false);
    expect(canInSomeScope(admin, "events.edit")).toBe(true);
    expect(canInSomeScope(admin, "audit.read")).toBe(false);
    expect(canInSomeScope(principal([{ roleId: SUPERADMIN_ROLE_ID }], false), "audit.read")).toBe(
      false,
    );
    expect(canInSomeScope(null, "audit.read")).toBe(false);
  });
});

describe("no privilege escalation through the Roles page", () => {
  const manager = principal([{ roleId: "role_manager" }]);
  const superadmin = principal([{ roleId: SUPERADMIN_ROLE_ID }]);

  it("saving a role needs roles.edit and only permissions the editor holds globally", () => {
    const draft = (permissions: string[]): RoleDefinition => ({
      id: "new",
      name: "New",
      permissions: normalizePermissions(permissions),
    });
    expect(canSaveRole(manager, draft(["articles.edit"]))).toBe(true);
    expect(canSaveRole(manager, draft(["members.pii"]))).toBe(false);
    expect(canSaveRole(principal([{ roleId: "editor" }]), draft(["articles.read"]))).toBe(false);
    const chapterManager = principal([{ roleId: "role_manager", scope: jp }]);
    expect(canSaveRole(chapterManager, draft(["articles.read"]))).toBe(false);
    expect(canSaveRole(superadmin, draft(["members.pii", "audit.revert"]))).toBe(true);
  });

  it("editing needs the old permissions too (no stripping roles you don't control)", () => {
    const updated = {
      ...role("chapter_admin"),
      permissions: normalizePermissions(["events.read"]),
    };
    expect(canSaveRole(manager, updated, role("chapter_admin"))).toBe(false);
    expect(canSaveRole(superadmin, updated, role("chapter_admin"))).toBe(true);
  });

  it("system roles can never be saved or deleted", () => {
    for (const id of Object.keys(SYSTEM_ROLES)) {
      expect(canSaveRole(superadmin, role(id))).toBe(false);
      expect(canDeleteRole(superadmin, role(id))).toBe(false);
    }
  });

  it("deleting a custom role needs roles.edit and its permissions", () => {
    expect(canDeleteRole(manager, role("viewer"))).toBe(false); // lacks events.read
    expect(canDeleteRole(superadmin, role("viewer"))).toBe(true);
  });

  it("assigning a role needs users.edit and every permission of that role", () => {
    expect(canAssignRole(manager, role("editor"))).toBe(false); // lacks gallery.edit / publish
    expect(canAssignRole(manager, role("member"))).toBe(true);
    expect(canAssignRole(principal([{ roleId: "viewer" }]), role("member"))).toBe(false);
  });

  it("only a superadmin assigns superadmin, even if a custom role holds every permission", () => {
    expect(canAssignRole(principal([{ roleId: "everything" }]), role(SUPERADMIN_ROLE_ID))).toBe(
      false,
    );
    expect(canAssignRole(superadmin, role(SUPERADMIN_ROLE_ID))).toBe(true);
  });
});

describe("Users page rules (accountChangeRefusal)", () => {
  const superadmin = principal([{ roleId: SUPERADMIN_ROLE_ID }]);
  const manager = principal([{ roleId: "role_manager" }]);

  it("nobody changes their own account", () => {
    expect(
      accountChangeRefusal({ actor: superadmin, targetUserId: "u1", superadminsAfter: 2 }),
    ).toBe("self");
  });

  it("adding or removing a role needs every permission of that role; superadmin only by a superadmin", () => {
    const base = { targetUserId: "u2", superadminsAfter: 1 };
    expect(accountChangeRefusal({ ...base, actor: manager, role: role("editor") })).toBe(
      "forbidden",
    );
    expect(accountChangeRefusal({ ...base, actor: manager, role: role(SUPERADMIN_ROLE_ID) })).toBe(
      "forbidden",
    );
    expect(
      accountChangeRefusal({ ...base, actor: superadmin, role: role(SUPERADMIN_ROLE_ID) }),
    ).toBeNull();
    expect(accountChangeRefusal({ ...base, actor: superadmin, role: role("editor") })).toBeNull();
  });

  it("a status change needs users.edit; the last active superadmin is protected", () => {
    const viewer = principal([{ roleId: "viewer" }]);
    expect(accountChangeRefusal({ actor: viewer, targetUserId: "u2", superadminsAfter: 1 })).toBe(
      "forbidden",
    );
    expect(accountChangeRefusal({ actor: null, targetUserId: "u2", superadminsAfter: 1 })).toBe(
      "forbidden",
    );
    expect(accountChangeRefusal({ actor: manager, targetUserId: "u2", superadminsAfter: 0 })).toBe(
      "last_superadmin",
    );
  });
});

describe("staff second sign-in method (hasTwoSignInMethods)", () => {
  it("needs an MFA factor, or a passkey plus another sign-in method", () => {
    const none = { providers: ["google.com"], mfaFactors: 0, passkeys: 0 };
    expect(hasTwoSignInMethods(none)).toBe(false);
    expect(hasTwoSignInMethods({ ...none, mfaFactors: 1 })).toBe(true);
    expect(hasTwoSignInMethods({ ...none, passkeys: 1 })).toBe(true);
    expect(hasTwoSignInMethods({ providers: [], mfaFactors: 0, passkeys: 2 })).toBe(false);
  });
});
