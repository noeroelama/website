import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAdmin } from "@website/auth";
import { createSqlAccountStore, createSqlRoleStore, createSqlUserStore } from "@website/db/sql";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { createLogger } from "@website/observability";
import {
  canAccessAdmin,
  DEFAULT_ROLE_COLOR,
  ROLE_COLORS,
  type Principal,
} from "@website/permissions";
import { createAccountActions } from "../../apps/admin/src/server/accounts";
import { createRoleActions } from "../../apps/admin/src/server/roles";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlAccountStore>[0];
const global = { type: "global" } as const;
const user = (roleIds: string[], extra: Record<string, unknown> = {}) => ({
  status: "active",
  version: 1,
  email: `${roleIds.join("-")}@example.org`,
  roleAssignments: roleIds.map((roleId) => ({ roleId, scope: global })),
  roleIds,
  ...extra,
});

let fake: ReturnType<typeof fakeDb>;
let methods: Record<string, { providers: string[]; mfaFactors: number }>;
let revokeSessions: ReturnType<typeof vi.fn<(uid: string) => Promise<void>>>;
let setDisabled: ReturnType<typeof vi.fn<(uid: string, disabled: boolean) => Promise<void>>>;
let logLines: string[];
let invitesSent: { email: string; roleName: string }[];
let deps: {
  accounts: ReturnType<typeof createSqlAccountStore>;
  roles: ReturnType<typeof createSqlRoleStore>;
  passkeys: ReturnType<typeof createMemoryPasskeyStore>;
  authAdmin: AccountAdmin;
  logger: ReturnType<typeof createLogger>;
  sendInvite: (invite: { email: string }, roleName: string) => Promise<unknown>;
};

beforeEach(() => {
  fake = fakeDb();
  const db = fake.db as unknown as Db;
  fake.docs.set("roles/editor", {
    name: "Editor",
    permissions: ["articles.edit", "articles.read", "articles.publish"],
    version: 1,
    deletedAt: null,
  });
  // A custom role without admin pages (no second sign-in method needed).
  fake.docs.set("roles/alumni", { name: "Alumni", permissions: [], version: 1, deletedAt: null });
  fake.docs.set("roles/user_manager", {
    name: "User manager",
    permissions: ["users.read", "users.edit"],
    version: 1,
    deletedAt: null,
  });
  fake.docs.set("users/boss", { uid: "boss", ...user(["superadmin"]) });
  fake.docs.set("users/manager", { uid: "manager", ...user(["user_manager"]) });
  fake.docs.set("users/ana", { uid: "ana", ...user(["visitor"]), email: "ana@example.org" });
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
  invitesSent = [];
  deps = {
    accounts: createSqlAccountStore(db),
    roles: createSqlRoleStore(db),
    passkeys: createMemoryPasskeyStore(),
    authAdmin,
    logger: createLogger({ service: "admin", write: (line) => logLines.push(line) }),
    sendInvite: (invite, roleName) => {
      invitesSent.push({ email: invite.email, roleName });
      return Promise.resolve("logged");
    },
  };
});

const principalOf = async (uid: string) =>
  (await createSqlUserStore(fake.db as unknown as Db).findPrincipalByUid(uid)) as Principal;
const freshContext = () =>
  Promise.resolve({
    actorEmail: "x@example.org",
    requestId: "req-123456",
    authTime: Date.now() / 1000,
  });
const as = (uid: string) => [() => principalOf(uid), freshContext] as const;
const giveEditor = { uid: "ana", version: 1, roleId: "editor", scope: global };

describe("Role Manager: give and remove roles", () => {
  it("a superadmin gives a staff role: written with its audit entry, sessions revoked, security event logged", async () => {
    const result = await createAccountActions(deps).assignRole(...as("boss"))(giveEditor);
    expect(result).toEqual({ ok: true, data: { version: 2 } });
    expect(fake.docs.get("users/ana")).toMatchObject({
      roleIds: ["visitor", "editor"],
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

  it("an account has one website role: a new one replaces it, organizational roles stay", async () => {
    const actions = createAccountActions(deps);
    fake.docs.set("users/eve", {
      uid: "eve",
      ...user(["editor"]),
      roleAssignments: [
        { roleId: "editor", scope: global },
        {
          roleId: "user_manager",
          scope: { type: "orgUnit", orgUnitId: "media" },
          periodId: "p2026",
          source: "appointment",
          appointmentId: "a1",
        },
      ],
      roleIds: ["editor", "user_manager"],
    });
    expect(
      await actions.assignRole(...as("boss"))({ ...giveEditor, uid: "eve", roleId: "alumni" }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(fake.docs.get("users/eve")?.["roleIds"]).toEqual(["visitor", "user_manager", "alumni"]);
    expect(logLines.join()).toContain('"replaced":["editor"]');

    // Replacing a role is removing it: only by someone who could give it (anti-escalation).
    await actions.assignRole(...as("boss"))(giveEditor);
    expect(
      await actions.assignRole(...as("manager"))({ ...giveEditor, version: 2, roleId: "alumni" }),
    ).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    expect(fake.docs.get("users/ana")?.["roleIds"]).toEqual(["visitor", "editor"]);

    // The last active superadmin keeps the role.
    fake.docs.set("users/boss2", { uid: "boss2", ...user(["superadmin"]) });
    fake.docs.set("users/boss", { uid: "boss", ...user(["superadmin"]), status: "inactive" });
    expect(
      await actions.assignRole(...as("manager"))({ ...giveEditor, uid: "boss2", roleId: "alumni" }),
    ).toMatchObject({ error: "refused" });
    expect(fake.docs.get("users/boss2")?.["roleIds"]).toEqual(["superadmin"]);
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
    expect(fake.docs.get("users/ana")?.["roleIds"]).toEqual(["visitor", "editor"]);
    expect(
      await actions.revokeRole(...as("boss"))({ ...giveEditor, version: 3, scope: jp }),
    ).toMatchObject({ ok: true, data: { version: 4 } });
    expect(fake.docs.get("users/ana")?.["roleIds"]).toEqual(["visitor"]);
    expect(logLines.filter((l) => l.includes("staff.role_changed"))).toHaveLength(3);
  });

  it("gives a role for one unit and one board period; staff cannot forge how it was assigned", async () => {
    const actions = createAccountActions(deps);
    const media = { type: "orgUnit", orgUnitId: "media" } as const;
    const forged = { ...giveEditor, scope: media, periodId: "p2026" };
    // Client-only fields (appointment source, revocation) are refused by the strict input.
    for (const extra of [{ source: "appointment" }, { revokedAt: null }]) {
      expect(await actions.assignRole(...as("boss"))({ ...forged, ...extra })).toMatchObject({
        ok: false,
        error: "invalid_input",
      });
    }
    expect(
      await actions.assignRole(...as("boss"))({ ...forged, scope: { type: "orgUnit" } }),
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await actions.assignRole(...as("boss"))(forged)).toMatchObject({ ok: true });
    expect(fake.docs.get("users/ana")?.["roleAssignments"]).toContainEqual({
      roleId: "editor",
      scope: media,
      periodId: "p2026",
      source: "manual",
      revokedAt: null,
      appointmentId: null,
    });
    // The same role for another period is a separate assignment; removal matches the period.
    expect(
      await actions.assignRole(...as("boss"))({ ...forged, version: 2, periodId: null }),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(await actions.revokeRole(...as("boss"))({ ...forged, version: 3 })).toMatchObject({
      ok: true,
      data: { version: 4 },
    });
    expect(fake.docs.get("users/ana")?.["roleAssignments"]).toEqual([
      {
        roleId: "visitor",
        scope: global,
        periodId: null,
        source: "manual",
        revokedAt: null,
        appointmentId: null,
      },
      {
        roleId: "editor",
        scope: media,
        periodId: null,
        source: "manual",
        revokedAt: null,
        appointmentId: null,
      },
    ]);
  });

  it("keeps ended appointment roles as history: in the record and the audit snapshot", async () => {
    const ended = {
      roleId: "editor",
      scope: global,
      periodId: "p2025",
      source: "appointment",
      revokedAt: new Date("2026-01-31T00:00:00Z"),
      appointmentId: "appt-1",
    };
    fake.docs.set("users/ana", {
      ...fake.docs.get("users/ana"),
      roleAssignments: [{ roleId: "visitor", scope: global }, ended],
    });
    expect(await createAccountActions(deps).assignRole(...as("boss"))(giveEditor)).toMatchObject({
      ok: true,
    });
    const [, entry] = [...fake.docs.entries()].find(([path]) => path.startsWith("auditLogs/"))!;
    const before = entry["before"] as { roleAssignments: unknown[] };
    expect(before.roleAssignments[1]).toEqual({
      ...ended,
      revokedAt: "2026-01-31T00:00:00.000Z",
      appointmentId: "appt-1",
    });
    expect(fake.docs.get("users/ana")?.["roleAssignments"]).toHaveLength(3);
  });

  it("roles without admin pages need no second method; entries are titled by uid when there is no e-mail", async () => {
    methods["ana"] = { providers: ["google.com"], mfaFactors: 0 };
    fake.docs.set("users/ana", { uid: "ana", ...user(["visitor"]), email: null });
    expect(
      await createAccountActions(deps).assignRole(...as("boss"))({
        ...giveEditor,
        roleId: "alumni",
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
    await createSqlUserStore(fake.db as unknown as Db).recordSignIn(
      { uid: "neo", email: "neo@example.org", name: "Neo" },
      at,
    );
    expect(await deps.accounts.get("neo")).toMatchObject({
      name: "Neo",
      status: "active",
      createdAt: at,
      lastSignInAt: at,
      roleAssignments: [{ roleId: "visitor", scope: global }],
      version: 1,
    });
  });

  it("reads accounts with missing fields safely", async () => {
    fake.docs.set("users/bare", { status: "weird", name: 42, createdAt: {}, chapterId: "../jp" });
    expect(await deps.accounts.get("bare")).toEqual({
      uid: "bare",
      email: null,
      name: null,
      status: "inactive",
      chapterId: null,
      // Every account is a Visitor (the default role), even one stored without roles.
      roleAssignments: [
        {
          roleId: "visitor",
          scope: global,
          periodId: null,
          source: "manual",
          revokedAt: null,
          appointmentId: null,
        },
      ],
      createdAt: null,
      lastSignInAt: null,
      version: 0,
    });
  });

  it("gives an account without the default role the Visitor role and stores it on the next change", async () => {
    fake.docs.set("users/old", { uid: "old", ...user(["editor"]) });
    const roleIds = async (uid: string) =>
      (await deps.accounts.get(uid))?.roleAssignments.map((a) => a.roleId);
    expect(await roleIds("old")).toEqual(["visitor", "editor"]);
    expect(
      await createAccountActions(deps).setStatus(...as("boss"))({
        uid: "old",
        version: 1,
        status: "inactive",
      }),
    ).toMatchObject({ ok: true });
    expect(fake.docs.get("users/old")?.["roleIds"]).toEqual(["visitor", "editor"]);
    // Visitors (only the default role) are never Role Manager rows.
    expect((await deps.accounts.listRoleHolders(["editor"])).map((u) => u.uid)).toEqual(["old"]);
  });

  it("lists the accounts holding one of the given roles (Role Manager), once each", async () => {
    const store = deps.accounts;
    fake.docs.set("users/both", { uid: "both", ...user(["editor", "user_manager"]) });
    fake.docs.set("users/ended", {
      uid: "ended",
      ...user(["visitor"]),
      roleAssignments: [
        { roleId: "visitor", scope: global },
        { roleId: "editor", scope: global, revokedAt: new Date("2026-01-01T00:00:00Z") },
      ],
      roleIds: ["visitor", "editor"],
    });
    const ids = async (roleIds: string[], chapterIds?: string[]) =>
      (await store.listRoleHolders(roleIds, chapterIds)).map((u) => u.uid).sort();
    // Ana holds only the default role; an ended (revoked) assignment does not count.
    expect(await ids(["superadmin", "editor", "user_manager"])).toEqual([
      "boss",
      "both",
      "manager",
    ]);
    expect(await ids(["editor"])).toEqual(["both"]);
    expect(await ids([])).toEqual([]);
    // More than 30 roles are queried in chunks of 30.
    const many = [...Array.from({ length: 30 }, (_, i) => `r${i}`), "superadmin"];
    expect(await ids(many)).toEqual(["boss"]);
    expect(await store.countActiveSuperadmins()).toBe(1);
    expect(await store.get("nobody")).toBeNull();
    expect(await store.get("bad/id")).toBeNull();
  });

  it("chapter-scoped staff list only their chapter's accounts and cannot change roles (A2)", async () => {
    fake.docs.set("users/ana", { ...fake.docs.get("users/ana"), chapterId: "jp" });
    fake.docs.set("users/kim", {
      uid: "kim",
      ...user(["visitor"]),
      email: "kim@example.org",
      chapterId: "kr",
    });
    fake.docs.set("users/sam", {
      uid: "sam",
      ...user(["editor"]),
      email: "sam@example.org",
      chapterId: "jp",
    });
    const store = deps.accounts;
    const holders = async (chapterIds: string[]) =>
      (await store.listRoleHolders(["editor", "visitor"], chapterIds)).map((u) => u.uid).sort();
    expect(await holders(["jp"])).toEqual(["ana", "sam"]);
    expect(await holders(["jp", "kr"])).toEqual(["ana", "kim", "sam"]);
    expect(await store.listRoleHolders(["superadmin"], ["jp"])).toEqual([]);
    expect(await holders([])).toEqual([]);
    await expect(
      store.listRoleHolders(
        ["editor"],
        Array.from({ length: 31 }, (_, i) => `c${i}`),
      ),
    ).rejects.toThrow(/30 chapters/);
    expect(await store.get("ana")).toMatchObject({ chapterId: "jp" });
    expect(await store.get("boss")).toMatchObject({ chapterId: null });

    // users.edit for one chapter is not enough to change anyone's roles (role changes are global).
    fake.docs.set("roles/jp_admin", {
      name: "JP admin",
      permissions: ["users.read", "users.edit"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("users/jpadmin", {
      uid: "jpadmin",
      ...user([]),
      roleAssignments: [{ roleId: "jp_admin", scope: { type: "chapter", chapterId: "jp" } }],
      roleIds: ["jp_admin"],
    });
    expect(
      await createAccountActions(deps).assignRole(...as("jpadmin"))({
        ...giveEditor,
        roleId: "visitor",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("Role Manager → Add New People: give a role, or invite by e-mail", () => {
  const at = new Date("2026-10-24T03:00:00Z");
  const inviteDoc = () =>
    [...fake.docs.entries()].filter(([path]) => path.startsWith("invites/")).map(([, d]) => d);
  const auditOf = (resourceType: string) =>
    [...fake.docs.entries()]
      .filter(([path, d]) => path.startsWith("auditLogs/") && d["resourceType"] === resourceType)
      .map(([, d]) => d);

  it("gives the role to the account found by e-mail (any case) or by its exact name", async () => {
    fake.docs.set("users/ana", { ...fake.docs.get("users/ana"), name: "Ana Putri" });
    const add = createAccountActions(deps).addPerson(...as("boss"));
    expect(await add({ person: " Ana Putri ", roleId: "editor" })).toEqual({
      ok: true,
      data: { invited: false },
    });
    expect(await add({ person: "ANA@example.org", roleId: "user_manager" })).toEqual({
      ok: true,
      data: { invited: false },
    });
    // One website role: the second replaces the first.
    expect(fake.docs.get("users/ana")).toMatchObject({
      roleIds: ["visitor", "user_manager"],
      version: 3,
    });
    expect(revokeSessions).toHaveBeenCalledWith("ana");
    expect(invitesSent).toEqual([]);

    // The same rules as giving a role on the account itself.
    expect(await add({ person: "ana@example.org", roleId: "user_manager" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("already has")],
    });
    expect(
      await createAccountActions(deps).addPerson(...as("manager"))({
        person: "boss@example.org",
        roleId: "editor",
      }),
    ).toMatchObject({ error: "refused" });
  });

  it("suggests accounts while typing: e-mail or name prefix, any letter case, at most 8", async () => {
    fake.docs.set("users/ana", { ...fake.docs.get("users/ana"), name: "Ana Putri" });
    fake.docs.set("users/anto", {
      uid: "anto",
      ...user(["visitor"]),
      email: "x@y.org",
      name: "Anto",
    });
    for (let i = 0; i < 10; i++) {
      fake.docs.set(`users/z${i}`, { uid: `z${i}`, ...user(["visitor"]), email: `zed${i}@y.org` });
    }
    const find = createAccountActions(deps).findPeople(...as("boss"));
    expect(await find({ query: "ANA" })).toEqual({
      ok: true,
      data: [{ uid: "ana", name: "Ana Putri", email: "ana@example.org" }],
    });
    // "ana putri" finds "Ana Putri" (the name is also tried with capital initials).
    expect(await find({ query: "ana putri" })).toMatchObject({ data: [{ uid: "ana" }] });
    expect(await find({ query: "An" })).toMatchObject({
      data: [{ uid: "ana" }, { uid: "anto" }],
    });
    const zed = await find({ query: "zed" });
    expect(zed.ok && zed.data).toHaveLength(8);
    expect(await find({ query: "nobody" })).toEqual({ ok: true, data: [] });
    expect(await find({ query: "a" })).toMatchObject({ ok: false, error: "invalid_input" });
    // Only staff who may add people get suggestions.
    fake.docs.set("roles/reader", {
      name: "Reader",
      permissions: ["users.read"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("users/reader", { uid: "reader", ...user(["reader"]) });
    expect(await createAccountActions(deps).findPeople(...as("reader"))({ query: "ana" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses a name that matches no account or several, and input that is not a person", async () => {
    fake.docs.set("users/ana", { ...fake.docs.get("users/ana"), name: "Ana" });
    fake.docs.set("users/ana2", { uid: "ana2", ...user(["visitor"]), name: "Ana" });
    const add = createAccountActions(deps).addPerson(...as("boss"));
    expect(await add({ person: "Nobody Here", roleId: "editor" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("Invite the person by e-mail")],
    });
    expect(await add({ person: "Ana", roleId: "editor" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("Several accounts")],
    });
    for (const person of ["", "not-an-email@", "a".repeat(121)]) {
      expect(await add({ person, roleId: "editor" })).toMatchObject({ error: "invalid_input" });
    }
    expect(await add({ person: "x@example.org", roleId: "ghost" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("does not exist")],
    });
  });

  it("invites an e-mail without an account: one role (a new one replaces it), audited and e-mailed", async () => {
    const add = createAccountActions(deps).addPerson(...as("boss"));
    expect(await add({ person: "New.Person@Example.org", roleId: "editor" })).toEqual({
      ok: true,
      data: { invited: true },
    });
    expect(inviteDoc()).toEqual([
      expect.objectContaining({
        email: "new.person@example.org",
        roleIds: ["editor"],
        status: "pending",
        invitedBy: "boss",
        version: 1,
      }),
    ]);
    expect(invitesSent).toEqual([{ email: "new.person@example.org", roleName: "Editor" }]);
    expect(await add({ person: "new.person@example.org", roleId: "editor" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("already invited")],
    });
    expect(await add({ person: "new.person@example.org", roleId: "alumni" })).toMatchObject({
      ok: true,
    });
    expect(inviteDoc()[0]).toMatchObject({ roleIds: ["alumni"], version: 2 });
    expect(auditOf("invite").map((d) => [d["action"], d["module"], d["revertible"]])).toEqual([
      ["CREATE", "users", false],
      ["UPDATE", "users", false],
    ]);
    expect(await deps.accounts.listInvites()).toEqual([
      expect.objectContaining({ email: "new.person@example.org", roleIds: ["alumni"] }),
    ]);

    // Escalation: nobody invites into a role they could not give.
    const asManager = createAccountActions(deps).addPerson(...as("manager"));
    for (const roleId of ["editor", "superadmin"]) {
      expect(await asManager({ person: "x@example.org", roleId })).toMatchObject({
        error: "refused",
        issues: [expect.stringContaining("permissions you hold")],
      });
    }
  });

  it("cancels a pending invite (kept as history, audited)", async () => {
    const actions = createAccountActions(deps);
    await actions.addPerson(...as("boss"))({ person: "new@example.org", roleId: "editor" });
    expect(await actions.cancelInvite(...as("boss"))({ email: "NEW@example.org" })).toEqual({
      ok: true,
      data: { email: "new@example.org" },
    });
    expect(inviteDoc()[0]).toMatchObject({ status: "cancelled", roleIds: [] });
    expect(await deps.accounts.listInvites()).toEqual([]);
    expect(auditOf("invite").at(-1)).toMatchObject({ action: "DELETE" });
    expect(await actions.cancelInvite(...as("boss"))({ email: "new@example.org" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("no pending invite")],
    });
    expect(
      await actions.cancelInvite(...as("boss"))({ email: "nobody@example.org" }),
    ).toMatchObject({ error: "refused" });
    // A cancelled invite can be sent again.
    expect(
      await actions.addPerson(...as("boss"))({ person: "new@example.org", roleId: "editor" }),
    ).toMatchObject({ ok: true, data: { invited: true } });
    expect(inviteDoc()[0]).toMatchObject({ status: "pending", roleIds: ["editor"] });
  });

  it("applies an invite at sign-in with a verified e-mail; staff roles wait for two sign-in methods", async () => {
    await createAccountActions(deps).addPerson(...as("boss"))({
      person: "neo@example.org",
      roleId: "editor",
    });
    const users = createSqlUserStore(fake.db as unknown as Db);
    const neo = { uid: "neo", email: "Neo@example.org", name: "Neo" };
    const two = vi.fn(() => Promise.resolve(false));

    // Unverified e-mail: anyone could have typed it, so nothing is applied.
    expect(await users.recordSignIn({ ...neo, emailVerified: false }, at, two)).toEqual({
      roleIds: ["visitor"],
    });
    expect(two).not.toHaveBeenCalled();
    // Verified, one sign-in method: the staff role waits.
    expect(await users.recordSignIn({ ...neo, emailVerified: true }, at, two)).toEqual({
      roleIds: ["visitor"],
    });
    expect(inviteDoc()[0]).toMatchObject({ status: "pending", roleIds: ["editor"] });
    // Meanwhile neo gets a role in the Role Manager.
    await createAccountActions(deps).assignRole(...as("boss"))({
      ...giveEditor,
      uid: "neo",
      roleId: "alumni",
    });
    // After adding a passkey, the next sign-in applies the invite, replacing that role.
    two.mockResolvedValue(true);
    expect(await users.recordSignIn({ ...neo, emailVerified: true }, at, two)).toEqual({
      roleIds: ["visitor", "editor"],
    });
    expect(inviteDoc()[0]).toMatchObject({ status: "accepted", roleIds: [] });
    expect(fake.docs.get("users/neo")?.["roleAssignments"]).toContainEqual(
      expect.objectContaining({ roleId: "editor", scope: global, source: "manual" }),
    );
    const bySystem = auditOf("user").filter(
      (d) => (d["actor"] as { type: string }).type === "system",
    );
    expect(bySystem).toHaveLength(1);
    // No invite: the methods are never looked up.
    two.mockClear();
    await users.recordSignIn({ ...neo, emailVerified: true }, at, two);
    await users.recordSignIn({ uid: "x", email: null, emailVerified: true }, at, two);
    await users.recordSignIn({ uid: "y", email: "y@example.org", emailVerified: true }, at);
    expect(two).not.toHaveBeenCalled();
  });

  it("applies on the first sign-in; drops invited roles that were deleted or are already held", async () => {
    const add = createAccountActions(deps).addPerson(...as("boss"));
    await add({ person: "kai@example.org", roleId: "alumni" });
    const users = createSqlUserStore(fake.db as unknown as Db);
    // A role without admin pages needs no check of the sign-in methods.
    expect(
      await users.recordSignIn({ uid: "kai", email: "kai@example.org", emailVerified: true }, at),
    ).toEqual({ roleIds: ["visitor", "alumni"] });
    expect(fake.docs.get("users/kai")).toMatchObject({
      version: 1,
      roleIds: ["visitor", "alumni"],
    });
    expect(
      [...fake.docs.values()].find((d) => d["email"] === "kai@example.org" && "invitedBy" in d),
    ).toMatchObject({ status: "accepted", roleIds: [] });
    // Without a way to check the sign-in methods, a staff role waits.
    await add({ person: "lia@example.org", roleId: "editor" });
    expect(
      await users.recordSignIn({ uid: "lia", email: "lia@example.org", emailVerified: true }, at),
    ).toEqual({ roleIds: ["visitor"] });

    await add({ person: "zoe@example.org", roleId: "editor" });
    fake.docs.set("users/zoe", {
      uid: "zoe",
      ...user(["visitor", "editor"]),
      email: "zoe@example.org",
    });
    const id = [...fake.docs.entries()].find(
      ([path, d]) => path.startsWith("invites/") && d["email"] === "zoe@example.org",
    )![0];
    fake.docs.set(id, { ...fake.docs.get(id), roleIds: ["editor", "gone"] });
    expect(
      await users.recordSignIn(
        { uid: "zoe", email: "zoe@example.org", emailVerified: true },
        at,
        () => Promise.resolve(true),
      ),
    ).toEqual({ roleIds: ["visitor", "editor"] });
    expect(fake.docs.get(id)).toMatchObject({ status: "accepted", roleIds: [] });
  });

  it("shows sign-in methods and dates on the person's popup, only inside the viewer's scope", async () => {
    const details = createAccountActions(deps).personDetails;
    expect(await details(...as("boss"))({ uid: "ana" })).toEqual({
      ok: true,
      data: { providers: ["google.com"], mfaFactors: 1, passkeys: 0 },
    });
    fake.docs.set("roles/jp_reader", {
      name: "JP reader",
      permissions: ["users.read"],
      version: 1,
      deletedAt: null,
    });
    fake.docs.set("users/jp", {
      uid: "jp",
      ...user([]),
      roleAssignments: [{ roleId: "jp_reader", scope: { type: "chapter", chapterId: "jp" } }],
      roleIds: ["jp_reader"],
    });
    fake.docs.set("users/ana", { ...fake.docs.get("users/ana"), chapterId: "jp" });
    expect(await details(...as("jp"))({ uid: "ana" })).toMatchObject({ ok: true });
    expect(await details(...as("jp"))({ uid: "boss" })).toEqual({ ok: false, error: "forbidden" });
    expect(await details(...as("boss"))({ uid: "ghost" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("does not exist")],
    });
  });
});

describe("Role Manager → Edit Role: custom roles are data", () => {
  const actions = () => createRoleActions({ roles: deps.roles, now: () => new Date() });

  it("creates a role from its name (audited) and refuses a duplicate name", async () => {
    const save = actions().saveRole(...as("boss"));
    const input = {
      name: "Chapter Reporter",
      color: "#10B981",
      permissions: ["articles.edit"],
      version: null,
    };
    expect(await save(input)).toEqual({ ok: true, data: { id: "chapter_reporter", version: 1 } });
    expect(fake.docs.get("roles/chapter_reporter")).toMatchObject({
      name: "Chapter Reporter",
      color: "#10B981",
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
      await asRita({
        name: "Publisher",
        color: "#10B981",
        permissions: ["articles.publish"],
        version: null,
      }),
    ).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    expect(
      await actions().saveRole(...as("boss"))({
        id: "visitor",
        name: "Visitor",
        color: "#10B981",
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
      await actions().saveRole(...as("boss"))({
        name: "!!",
        color: "#10B981",
        permissions: [],
        version: null,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("letters")] });
    expect(
      await actions().deleteRole(...as("boss"))({ id: "superadmin", version: 1 }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("Built-in")] });
    expect(
      await actions().saveRole(...as("boss"))({
        id: "editor",
        name: "Editor",
        color: "#10B981",
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
        color: "#6366F1",
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

  it("someone with roles.edit cannot delete roles holding more than they have", async () => {
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
  });

  it("gives every role a colour from the palette; built-in and older roles get one too", async () => {
    const save = actions().saveRole(...as("boss"));
    for (const color of ["#123456", "red", undefined]) {
      expect(await save({ name: "Painted", color, permissions: [], version: null })).toMatchObject({
        ok: false,
        error: "invalid_input",
      });
    }
    expect(
      await save({ name: "Painted", color: ROLE_COLORS[2], permissions: [], version: null }),
    ).toMatchObject({ ok: true });
    const audit = [...fake.docs.values()].find(
      (d) => d["module"] === "roles" && d["title"] === "Painted",
    );
    expect(audit?.["after"]).toMatchObject({ color: ROLE_COLORS[2] });
    expect(await deps.roles.get("painted")).toMatchObject({ color: ROLE_COLORS[2] });
    // Saved before colours existed, or a colour that is not in the palette (any more).
    expect(await deps.roles.get("editor")).toMatchObject({ color: DEFAULT_ROLE_COLOR });
    fake.docs.set("roles/odd", { name: "Odd", permissions: [], color: "#000000", version: 1 });
    expect(await deps.roles.get("odd")).toMatchObject({ color: DEFAULT_ROLE_COLOR });
    for (const role of await deps.roles.list()) expect(ROLE_COLORS).toContain(role.color);
  });
});
