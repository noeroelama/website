import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createFirestoreRoleStore, createFirestoreUserStore } from "@website/db/firestore";
import { can, canAccessAdmin, DEFAULT_ROLE_ASSIGNMENTS } from "@website/permissions";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreUserStore>[0];
const setup = () => {
  const fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  return { ...fake, users: createFirestoreUserStore(db), roles: createFirestoreRoleStore(db) };
};
const first = new Date("2026-10-16T01:00:00Z");
const later = new Date("2026-10-17T09:30:00Z");
const ana = { uid: "uid-ana", email: "ana@example.org", name: "Ana" };

describe("first sign-in record (users/{uid})", () => {
  it("creates the record once with the default role; later sign-ins only update lastSignInAt", async () => {
    const { users, docs } = setup();
    await users.recordSignIn(ana, first);
    const created = docs.get("users/uid-ana");
    expect(created).toMatchObject({
      email: "ana@example.org",
      name: "Ana",
      status: "active",
      roleAssignments: DEFAULT_ROLE_ASSIGNMENTS,
    });

    // Staff changed the roles in between: a new sign-in must not reset them.
    docs.set("users/uid-ana", {
      ...created,
      roleAssignments: [{ roleId: "member", scope: { type: "global" } }],
    });
    await users.recordSignIn({ ...ana, name: "Ana B." }, later);
    const updated = docs.get("users/uid-ana") as Record<string, { toDate(): Date }>;
    expect(updated["createdAt"]?.toDate()).toEqual(first);
    expect(updated["lastSignInAt"]?.toDate()).toEqual(later);
    expect(updated).toMatchObject({
      name: "Ana B.",
      roleAssignments: [{ roleId: "member", scope: { type: "global" } }],
    });
  });

  it("concurrent first sign-ins create one record (transaction)", async () => {
    const { users, writes } = setup();
    await Promise.all([users.recordSignIn(ana, first), users.recordSignIn(ana, later)]);
    // A create carries a fresh Date; an update keeps the stored createdAt.
    const creates = writes.filter(
      (w) => w.path === "users/uid-ana" && w.data["createdAt"] instanceof Date,
    );
    expect(creates).toHaveLength(1);
  });
});

describe("principal from Firestore (admin user directory)", () => {
  it("returns null for an account without a user record", async () => {
    const { users } = setup();
    expect(await users.findPrincipalByUid("unknown")).toBeNull();
  });

  it("an account record without role assignments has no permissions (and reads no roles)", async () => {
    const { users, docs, getAll } = setup();
    await users.recordSignIn({ uid: "u2", email: null }, first); // e.g. a provider without a name
    expect(docs.get("users/u2")).toMatchObject({ email: null, name: null });
    docs.set("users/u2", { status: "active" });
    const principal = await users.findPrincipalByUid("u2");
    expect(principal).toMatchObject({ userId: "u2", active: true, assignments: [] });
    expect(getAll).toHaveBeenCalledTimes(1); // user + active period together; no roles read
  });

  it("resolves custom roles from roles/{id} and drops assignments to missing roles", async () => {
    const { users, docs, getAll } = setup();
    docs.set("roles/editor", {
      name: "Editor",
      permissions: ["articles.publish"],
      deletedAt: null,
    });
    docs.set("users/u1", {
      status: "active",
      roleAssignments: [
        { roleId: "editor", scope: { type: "chapter", chapterId: "jp" } },
        { roleId: "gone", scope: { type: "global" } },
        { roleId: "user", scope: { type: "global" } },
      ],
    });
    const principal = await users.findPrincipalByUid("u1");
    expect(principal?.assignments.map((a) => a.roleId)).toEqual(["editor", "user"]);
    expect(can(principal, "articles.publish", { chapterId: "jp" })).toBe(true);
    expect(can(principal, "articles.read", { chapterId: "jp" })).toBe(true); // publish adds read
    expect(can(principal, "articles.publish", { chapterId: "kr" })).toBe(false);
    expect(getAll).toHaveBeenCalledTimes(2); // user + period, then all custom roles in one read
  });

  it("keeps period-bound assignments only for the active period (settings/activePeriod)", async () => {
    const { users, docs } = setup();
    docs.set("users/u1", {
      status: "active",
      roleAssignments: [
        { roleId: "superadmin", scope: { type: "global" }, periodId: "p2025" },
        { roleId: "superadmin", scope: { type: "orgUnit", orgUnitId: "media" }, periodId: "p2026" },
        { roleId: "superadmin", scope: { type: "global" }, revokedAt: new Date("2026-01-01") },
        { roleId: "user", scope: { type: "global" } },
      ],
    });
    const before = await users.findPrincipalByUid("u1"); // no active period yet
    expect(before?.assignments.map((a) => a.roleId)).toEqual(["user"]);

    docs.set("settings/activePeriod", { periodId: "p2026" });
    const during = await users.findPrincipalByUid("u1");
    expect(during?.assignments.map((a) => a.scope)).toEqual([
      { type: "orgUnit", orgUnitId: "media" },
      { type: "global" },
    ]);
    expect(can(during, "users.edit", { orgUnitPath: ["board", "media"] })).toBe(true);
    expect(can(during, "users.edit", { orgUnitPath: ["board", "finance"] })).toBe(false);
  });

  it("an inactive account resolves to a principal that can do nothing", async () => {
    const { users, docs } = setup();
    docs.set("users/u1", {
      status: "inactive",
      roleAssignments: [{ roleId: "superadmin", scope: { type: "global" } }],
    });
    const principal = await users.findPrincipalByUid("u1");
    expect(principal?.active).toBe(false);
    expect(canAccessAdmin(principal)).toBe(false);
  });

  it("ignores a stored role document that uses a built-in id, deleted roles and malformed data", async () => {
    const { users, docs } = setup();
    docs.set("roles/member", { name: "Member", permissions: ["users.edit"], deletedAt: null });
    docs.set("roles/old", { name: "Old", permissions: ["users.edit"], deletedAt: new Date() });
    docs.set("users/u1", {
      status: "active",
      roleAssignments: [
        { roleId: "member", scope: { type: "global" } },
        { roleId: "old", scope: { type: "global" } },
        { roleId: "bad id/../x", scope: { type: "global" } },
        { roleId: "user", scope: { type: "planet" } },
        { roleId: "user", scope: { type: "planet", orgUnitId: "earth" } },
        { roleId: "superadmin", scope: { type: "orgUnit", orgUnitId: "../x" } },
        { roleId: "superadmin", scope: { type: "global" }, revokedAt: "not a date" },
        "superadmin",
      ],
    });
    const principal = await users.findPrincipalByUid("u1");
    expect(principal?.assignments.map((a) => a.roleId)).toEqual(["member"]);
    expect(canAccessAdmin(principal)).toBe(false);
  });
});

describe("roles repository", () => {
  it("lists built-in roles from code first, then stored custom roles; built-in ids are never read from Firestore", async () => {
    const { roles, docs } = setup();
    docs.set("roles/editor", {
      name: "Editor",
      permissions: ["articles.edit", "nope"],
      deletedAt: null,
    });
    docs.set("roles/superadmin", { name: "Hijack", permissions: [], deletedAt: null });
    docs.set("roles/old", { name: "Old", permissions: [], deletedAt: new Date() });
    docs.set("roles/broken", { permissions: ["articles.read"] }); // no name
    docs.set("roles/admin", { name: "Admin", permissions: ["users.read"], deletedAt: null });
    const list = await roles.list();
    expect(list.map((r) => r.id)).toEqual(["superadmin", "member", "user", "admin", "editor"]);
    expect(list.find((r) => r.id === "superadmin")?.name).toBe("Superadmin");
    expect(list.find((r) => r.id === "editor")?.permissions).toEqual([
      "articles.edit",
      "articles.read",
    ]);

    expect((await roles.get("superadmin"))?.name).toBe("Superadmin");
    expect((await roles.get("editor"))?.name).toBe("Editor");
    expect(await roles.get("old")).toBeNull();
    expect(await roles.get("missing")).toBeNull();
    expect(await roles.get("../users/x")).toBeNull(); // never a path outside roles/
    const many = await roles.getMany(["editor", "user", "missing", "old"]);
    expect([...many.keys()]).toEqual(["editor", "user"]);
  });
});

describe("grant-superadmin bootstrap script", () => {
  const script = "infrastructure/scripts/grant-superadmin.mjs";
  const noFirebase = {
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...noFirebase },
    });

  it("refuses to run without an e-mail or without the admin service account", () => {
    const noEmail = run([]);
    expect(noEmail.status).toBe(2);
    expect(noEmail.stderr).toContain("Usage");
    const noCredentials = run(["--email", "a@example.org"]);
    expect(noCredentials.status).toBe(2);
    expect(noCredentials.stderr).toContain("FIREBASE_PRIVATE_KEY");
  });
});
