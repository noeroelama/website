import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAdmin } from "@website/auth";
import {
  createFirestoreAccountStore,
  createFirestoreRoleStore,
  createFirestoreUserStore,
} from "@website/db/firestore";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { createLogger } from "@website/observability";
import { canAccessAdmin, PAGE_PERMISSIONS, type Principal } from "@website/permissions";
import { createAccountActions } from "../../apps/admin/src/server/accounts";
import { createRoleActions, SUGGESTED_ROLES } from "../../apps/admin/src/server/roles";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreAccountStore>[0];
const global = { type: "global" } as const;
const user = (roleIds: string[], extra: Record<string, unknown> = {}) => ({
  status: "active",
  version: 1,
  email: `${roleIds.join("-")}@example.org`,
  roleAssignments: roleIds.map((roleId) => ({ roleId, scope: global })),
  roleIds,
  ...extra,
});

let fake: ReturnType<typeof fakeFirestore>;
let methods: Record<string, { providers: string[]; mfaFactors: number }>;
let revokeSessions: ReturnType<typeof vi.fn<(uid: string) => Promise<void>>>;
let setDisabled: ReturnType<typeof vi.fn<(uid: string, disabled: boolean) => Promise<void>>>;
let logLines: string[];
let deps: {
  accounts: ReturnType<typeof createFirestoreAccountStore>;
  roles: ReturnType<typeof createFirestoreRoleStore>;
  passkeys: ReturnType<typeof createMemoryPasskeyStore>;
  authAdmin: AccountAdmin;
  logger: ReturnType<typeof createLogger>;
};

beforeEach(() => {
  fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  fake.docs.set("roles/editor", {
    name: "Editor",
    permissions: ["articles.edit", "articles.read", "articles.publish"],
    version: 1,
    deletedAt: null,
  });
  fake.docs.set("roles/user_manager", {
    name: "User manager",
    permissions: ["users.read", "users.edit"],
    version: 1,
    deletedAt: null,
  });
  fake.docs.set("users/boss", { uid: "boss", ...user(["superadmin"]) });
  fake.docs.set("users/manager", { uid: "manager", ...user(["user_manager"]) });
  fake.docs.set("users/ana", { uid: "ana", ...user(["user"]), email: "ana@example.org" });
  methods = {
    ana: { providers: ["google.com"], mfaFactors: 1 },
    boss: { providers: ["google.com"], mfaFactors: 1 },
  };
  revokeSessions = vi.fn((_uid: string) => Promise.resolve());
  setDisabled = vi.fn((_uid: string, _disabled: boolean) => Promise.resolve());
  const authAdmin: AccountAdmin = {
    signInMethods: (uid) => Promise.resolve(methods[uid] ?? { providers: [], mfaFactors: 0 }),
    setDisabled,
    revokeSessions,
  };
  logLines = [];
  deps = {
    accounts: createFirestoreAccountStore(db),
    roles: createFirestoreRoleStore(db),
    passkeys: createMemoryPasskeyStore(),
    authAdmin,
    logger: createLogger({ service: "admin", write: (line) => logLines.push(line) }),
  };
});

const principalOf = async (uid: string) =>
  (await createFirestoreUserStore(fake.db as unknown as Db).findPrincipalByUid(uid)) as Principal;
const freshContext = () =>
  Promise.resolve({
    actorEmail: "x@example.org",
    requestId: "req-123456",
    authTime: Date.now() / 1000,
  });
const as = (uid: string) => [() => principalOf(uid), freshContext] as const;
const giveEditor = { uid: "ana", version: 1, roleId: "editor", scope: global };

describe("Users page: give and remove roles", () => {
  it("a superadmin gives a staff role: written with its audit entry, sessions revoked, security event logged", async () => {
    const result = await createAccountActions(deps).assignRole(...as("boss"))(giveEditor);
    expect(result).toEqual({ ok: true, data: { version: 2 } });
    expect(fake.docs.get("users/ana")).toMatchObject({
      roleIds: ["user", "editor"],
      version: 2,
    });
    const entries = [...fake.docs.entries()].filter(([path]) => path.startsWith("auditLogs/"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.[1]).toMatchObject({
      module: "users",
      action: "UPDATE",
      resourceId: "ana",
      title: "ana@example.org",
      actor: { type: "staff", id: "boss", email: "x@example.org" },
      revertible: false,
    });
    expect(revokeSessions).toHaveBeenCalledWith("ana");
    expect(logLines.join()).toContain("staff.role_changed");
    expect(canAccessAdmin(await principalOf("ana"))).toBe(true);
  });

  it("refuses a staff role while the account has only one sign-in method; a passkey fixes it", async () => {
    methods["ana"] = { providers: ["google.com"], mfaFactors: 0 };
    const actions = createAccountActions(deps);
    expect(await actions.assignRole(...as("boss"))(giveEditor)).toMatchObject({
      ok: false,
      error: "refused",
      issues: [expect.stringContaining("second sign-in method")],
    });
    expect(fake.docs.get("users/ana")).toMatchObject({ version: 1 });
    await deps.passkeys.add({
      id: "cred",
      userId: "ana",
      publicKey: "k",
      counter: 0,
      transports: [],
      createdAt: new Date(),
      lastUsedAt: null,
    });
    expect(await actions.assignRole(...as("boss"))(giveEditor)).toMatchObject({ ok: true });
  });

  it("refuses escalation: you cannot give a role whose permissions you lack, nor superadmin", async () => {
    const actions = createAccountActions(deps);
    expect(await actions.assignRole(...as("manager"))(giveEditor)).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    expect(
      await actions.assignRole(...as("manager"))({ ...giveEditor, roleId: "superadmin" }),
    ).toMatchObject({ error: "refused" });
  });

  it("refuses changes to your own account and stale versions", async () => {
    const actions = createAccountActions(deps);
    expect(
      await actions.revokeRole(...as("boss"))({
        uid: "boss",
        version: 1,
        roleId: "superadmin",
        scope: global,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("your own")] });
    expect(await actions.assignRole(...as("boss"))({ ...giveEditor, version: 7 })).toEqual({
      ok: false,
      error: "conflict",
    });
  });

  it("never leaves the organisation without an active superadmin", async () => {
    const actions = createAccountActions(deps);
    // The user manager may deactivate accounts, but not the only superadmin.
    expect(
      await actions.setStatus(...as("manager"))({ uid: "boss", version: 1, status: "inactive" }),
    ).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("last active superadmin")],
    });
    expect(fake.docs.get("users/boss")).toMatchObject({ status: "active" });
  });

  it("deactivating an account disables it in Firebase Auth, ends its sessions and closes admin", async () => {
    fake.docs.set("users/ana", { uid: "ana", ...user(["editor"]) });
    const result = await createAccountActions(deps).setStatus(...as("boss"))({
      uid: "ana",
      version: 1,
      status: "inactive",
    });
    expect(result).toMatchObject({ ok: true });
    expect(setDisabled).toHaveBeenCalledWith("ana", true);
    expect(revokeSessions).toHaveBeenCalledWith("ana");
    expect(canAccessAdmin(await principalOf("ana"))).toBe(false);
  });

  it("role changes need a sign-in in the last 15 minutes", async () => {
    const stale = () =>
      Promise.resolve({
        actorEmail: null,
        requestId: "req-123456",
        authTime: Date.now() / 1000 - 3600,
      });
    expect(
      await createAccountActions(deps).assignRole(() => principalOf("boss"), stale)(giveEditor),
    ).toEqual({ ok: false, error: "reauthenticate" });
  });

  it("removes a role, refuses duplicates and unknown roles, and keeps chapter scopes apart", async () => {
    const actions = createAccountActions(deps);
    const jp = { type: "chapter", chapterId: "jp" } as const;
    expect(await actions.assignRole(...as("boss"))({ ...giveEditor, scope: jp })).toMatchObject({
      ok: true,
      data: { version: 2 },
    });
    expect(
      await actions.assignRole(...as("boss"))({ ...giveEditor, version: 2, scope: jp }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already has")] });
    expect(
      await actions.assignRole(...as("boss"))({ ...giveEditor, version: 2, roleId: "ghost" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("does not exist")] });
    // Removing the global assignment (which it does not have) leaves the chapter one in place.
    expect(await actions.revokeRole(...as("boss"))({ ...giveEditor, version: 2 })).toMatchObject({
      ok: true,
      data: { version: 3 },
    });
    expect(fake.docs.get("users/ana")?.["roleIds"]).toEqual(["user", "editor"]);
    expect(
      await actions.revokeRole(...as("boss"))({ ...giveEditor, version: 3, scope: jp }),
    ).toMatchObject({ ok: true, data: { version: 4 } });
    expect(fake.docs.get("users/ana")?.["roleIds"]).toEqual(["user"]);
    expect(logLines.filter((l) => l.includes("staff.role_changed"))).toHaveLength(3);
  });

  it("built-in roles without admin pages need no second method; entries are titled by uid when there is no e-mail", async () => {
    methods["ana"] = { providers: ["google.com"], mfaFactors: 0 };
    fake.docs.set("users/ana", { uid: "ana", ...user(["user"]), email: null });
    expect(
      await createAccountActions(deps).assignRole(...as("boss"))({
        ...giveEditor,
        roleId: "member",
      }),
    ).toMatchObject({ ok: true });
    const entry = [...fake.docs.entries()].find(([path]) => path.startsWith("auditLogs/"));
    expect(entry?.[1]).toMatchObject({ title: "ana" });
    expect(
      await createAccountActions(deps).setStatus(...as("boss"))({
        uid: "ghost",
        version: 1,
        status: "inactive",
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("does not exist")] });
  });

  it("reads what the first sign-in wrote", async () => {
    const at = new Date("2026-10-16T03:00:00Z");
    await createFirestoreUserStore(fake.db as unknown as Db).recordSignIn(
      { uid: "neo", email: "neo@example.org", name: "Neo" },
      at,
    );
    expect(await deps.accounts.get("neo")).toMatchObject({
      name: "Neo",
      status: "active",
      createdAt: at,
      lastSignInAt: at,
      roleAssignments: [{ roleId: "user", scope: global }],
      version: 1,
    });
  });

  it("reads accounts with missing fields safely", async () => {
    fake.docs.set("users/bare", { status: "weird", name: 42, createdAt: {} });
    expect(await deps.accounts.get("bare")).toEqual({
      uid: "bare",
      email: null,
      name: null,
      status: "inactive",
      roleAssignments: [],
      createdAt: null,
      lastSignInAt: null,
      version: 0,
    });
  });

  it("lists accounts by role and status, page by page", async () => {
    const store = deps.accounts;
    const first = await store.list({ limit: 2 });
    expect(first.items.map((u) => u.uid)).toEqual(["ana", "boss"]);
    const second = await store.list({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second).toMatchObject({ items: [{ uid: "manager" }], nextCursor: null });
    expect((await store.list({ limit: 10, roleId: "superadmin" })).items).toHaveLength(1);
    expect((await store.list({ limit: 10, status: "inactive" })).items).toHaveLength(0);
    expect(await store.countActiveSuperadmins()).toBe(1);
    expect(await store.get("nobody")).toBeNull();
    expect(await store.get("bad/id")).toBeNull();
  });
});

describe("Roles page: custom roles are data", () => {
  const actions = () => createRoleActions({ roles: deps.roles, now: () => new Date() });

  it("creates a role from its name (audited) and refuses a duplicate name", async () => {
    const save = actions().saveRole(...as("boss"));
    const input = { name: "Chapter Reporter", permissions: ["articles.edit"], version: null };
    expect(await save(input)).toEqual({ ok: true, data: { id: "chapter_reporter", version: 1 } });
    expect(fake.docs.get("roles/chapter_reporter")).toMatchObject({
      name: "Chapter Reporter",
      permissions: ["articles.edit", "articles.read"],
    });
    expect(
      [...fake.docs.values()].some(
        (d) =>
          d["module"] === "roles" && d["action"] === "CREATE" && d["title"] === "Chapter Reporter",
      ),
    ).toBe(true);
    expect(await save(input)).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("already exists")],
    });
  });

  it("refuses roles with permissions the editor lacks, built-in ids and roles still held", async () => {
    fake.docs.set("roles/role_editor", {
      name: "Role editor",
      permissions: ["roles.read", "roles.edit", "articles.read"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("users/rita", { uid: "rita", ...user(["role_editor"]) });
    const asRita = actions().saveRole(...as("rita"));
    expect(
      await asRita({ name: "Publisher", permissions: ["articles.publish"], version: null }),
    ).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    expect(
      await actions().saveRole(...as("boss"))({
        id: "member",
        name: "Member",
        permissions: [],
        version: 1,
      }),
    ).toMatchObject({ error: "refused" });
    expect(
      await actions().deleteRole(...as("boss"))({ id: "user_manager", version: 1 }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("still hold")] });
  });

  it("moves an unused role to trash (soft delete) and it disappears from the list", async () => {
    fake.docs.set("roles/old", {
      name: "Old",
      permissions: ["articles.read"],
      version: 3,
      deletedAt: null,
    });
    expect(await actions().deleteRole(...as("boss"))({ id: "old", version: 3 })).toEqual({
      ok: true,
      data: { id: "old" },
    });
    expect(fake.docs.get("roles/old")?.["deletedAt"]).toBeTruthy();
    expect((await deps.roles.list()).map((r) => r.id)).not.toContain("old");
  });

  it("refuses names without letters, built-in deletes and stale versions", async () => {
    expect(
      await actions().saveRole(...as("boss"))({ name: "!!", permissions: [], version: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("letters")] });
    expect(
      await actions().deleteRole(...as("boss"))({ id: "superadmin", version: 1 }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("Built-in")] });
    expect(
      await actions().saveRole(...as("boss"))({
        id: "editor",
        name: "Editor",
        permissions: [],
        version: 9,
      }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(await actions().deleteRole(...as("boss"))({ id: "editor", version: 9 })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(
      await actions().saveRole(...as("boss"))({
        id: "editor",
        name: "Editor (updated)",
        permissions: ["articles.read"],
        version: 1,
      }),
    ).toEqual({ ok: true, data: { id: "editor", version: 2 } });
    expect(await deps.roles.countHolders(["superadmin", "editor"])).toEqual(
      new Map([
        ["superadmin", 1],
        ["editor", 0],
      ]),
    );
  });

  it("someone with roles.edit cannot delete or seed roles holding more than they have", async () => {
    fake.docs.set("roles/role_editor", {
      name: "Role editor",
      permissions: ["roles.read", "roles.edit"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("roles/unused", {
      name: "Unused",
      permissions: ["articles.read"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("users/rita", { uid: "rita", ...user(["role_editor"]) });
    expect(await actions().deleteRole(...as("rita"))({ id: "unused", version: 1 })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    expect(await actions().deleteRole(...as("rita"))({ id: "nothing-here", version: 1 })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(await actions().addSuggestedRoles(...as("rita"))({})).toEqual({
      ok: true,
      data: { added: [] },
    });
  });

  it("adds only the suggested roles that are missing", async () => {
    const result = await actions().addSuggestedRoles(...as("boss"))({});
    expect(result).toEqual({
      ok: true,
      data: { added: SUGGESTED_ROLES.map((r) => r.id).filter((id) => id !== "editor") },
    });
    expect(fake.docs.get("roles/admin")?.["permissions"]).toEqual(
      expect.arrayContaining([...PAGE_PERMISSIONS].filter((p) => p.startsWith("users."))),
    );
    expect((await actions().addSuggestedRoles(...as("boss"))({})).ok && true).toBe(true);
  });
});
