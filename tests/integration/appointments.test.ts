import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAdmin } from "@website/auth";
import {
  createFirestoreAccountStore,
  createFirestoreAppointmentStore,
  createFirestoreOrgUnitStore,
  createFirestoreRoleStore,
  createFirestoreUserStore,
} from "@website/db/firestore";
import { createMemoryPasskeyStore } from "@website/db/memory";
import {
  derivedAssignments,
  SUGGESTED_APPOINTMENT_ROLES,
  type OrgUnit,
} from "@website/domain/organizations";
import { createLogger } from "@website/observability";
import { can, normalizePermissions, type Principal } from "@website/permissions";
import { createAccountActions } from "../../apps/admin/src/server/accounts";
import { createAppointmentActions } from "../../apps/admin/src/server/appointments";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreAppointmentStore>[0];
const now = new Date("2026-11-02T03:00:00Z");
const unit = (id: string, type: OrgUnit["type"], periodId = "p2026") => ({
  periodId,
  parentId: null,
  path: id === "koor" ? [] : ["koor"],
  name: id,
  code: id.toUpperCase(),
  type,
  description: "",
  sort: 0,
  active: true,
  version: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  deletedAt: null,
});
const role = (permissions: string[]) => ({
  name: "Role",
  permissions: normalizePermissions(permissions),
  version: 1,
  deletedAt: null,
});

let fake: ReturnType<typeof fakeFirestore>;
let revokeSessions: ReturnType<typeof vi.fn<(uid: string) => Promise<void>>>;
let methods: Record<string, { providers: string[]; mfaFactors: number }>;
let logLines: string[];
let actions: ReturnType<typeof createAppointmentActions>;
let appointments: ReturnType<typeof createFirestoreAppointmentStore>;

const principalOf = async (uid: string) =>
  (await createFirestoreUserStore(fake.db as unknown as Db).findPrincipalByUid(uid)) as Principal;
const context = () =>
  Promise.resolve({
    actorEmail: "x@example.org",
    requestId: "req-123456",
    authTime: Date.now() / 1000,
  });
const as = (uid: string) => [() => principalOf(uid), context] as const;
const appointInput = (email: string, orgUnitId: string, seat: string, title = "Pengurus") => ({
  email,
  orgUnitId,
  seat,
  title,
});
const assignmentsOf = (uid: string) =>
  fake.docs.get(`users/${uid}`)?.["roleAssignments"] as Array<Record<string, unknown>>;

beforeEach(() => {
  fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  fake.docs.set("settings/activePeriod", { periodId: "p2026" });
  fake.docs.set("periods/p2026", { status: "active" });
  fake.docs.set("orgUnits/koor", unit("koor", "koordinator"));
  fake.docs.set("orgUnits/media", unit("media", "direktorat"));
  fake.docs.set("orgUnits/old", unit("old", "direktorat", "p2025"));
  fake.docs.set("roles/officer", role(["events.read", "structure.read"]));
  fake.docs.set("roles/director", role(["events.edit", "appointments.read"]));
  fake.docs.set("roles/directorate_secretary", role(["events.edit"]));
  fake.docs.set("roles/coordinator", role(["appointments.edit", "structure.edit", "events.edit"]));
  fake.docs.set("roles/secretary_general", role(["appointments.edit", "structure.edit"]));
  fake.docs.set("roles/treasurer", role(["periods.read"]));
  const user = (uid: string, roleIds: string[]) => ({
    uid,
    email: `${uid}@example.org`,
    name: uid,
    status: "active",
    version: 1,
    roleAssignments: roleIds.map((roleId) => ({ roleId, scope: { type: "global" } })),
    roleIds,
  });
  fake.docs.set("users/boss", user("boss", ["superadmin"]));
  fake.docs.set("users/ana", user("ana", ["user"]));
  fake.docs.set("users/rio", user("rio", ["user"]));
  fake.docs.set("users/sec", {
    ...user("sec", []),
    roleAssignments: [{ roleId: "secretary_general", scope: { type: "global" } }],
    roleIds: ["secretary_general"],
  });
  methods = {
    ana: { providers: ["google.com"], mfaFactors: 1 },
    rio: { providers: ["google.com"], mfaFactors: 1 },
    boss: { providers: ["google.com"], mfaFactors: 1 },
  };
  revokeSessions = vi.fn((_uid: string) => Promise.resolve());
  const authAdmin: AccountAdmin = {
    signInMethods: (uid) => Promise.resolve(methods[uid] ?? { providers: [], mfaFactors: 0 }),
    setDisabled: () => Promise.resolve(),
    revokeSessions,
  };
  logLines = [];
  appointments = createFirestoreAppointmentStore(db);
  actions = createAppointmentActions({
    appointments,
    accounts: createFirestoreAccountStore(db),
    units: createFirestoreOrgUnitStore(db),
    roles: createFirestoreRoleStore(db),
    passkeys: createMemoryPasskeyStore(),
    authAdmin,
    logger: createLogger({ service: "admin", write: (line) => logLines.push(line) }),
    now: () => now,
  });
});

describe("derived roles of an appointment (B7, PPIDK PenugasanService)", () => {
  const map = SUGGESTED_APPOINTMENT_ROLES;
  const media = { id: "media", type: "direktorat" as const };
  it("everyone is an officer; heads and secretaries get their unit; core seats are global", () => {
    expect(derivedAssignments("member", media, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
    ]);
    expect(derivedAssignments("head", media, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "director", scope: { type: "orgUnit", orgUnitId: "media" } },
    ]);
    expect(derivedAssignments("secretary", { id: "dsn", type: "bidang" }, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "directorate_secretary", scope: { type: "orgUnit", orgUnitId: "dsn" } },
    ]);
    expect(derivedAssignments("head", { id: "koor", type: "koordinator" }, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "coordinator", scope: { type: "global" } },
    ]);
    // A member or secretary of a core unit (e.g. the Secretary General's staff) is an officer.
    expect(derivedAssignments("secretary", { id: "sj", type: "sekjen" }, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
    ]);
  });
});

describe("appointments → roles (B7)", () => {
  it("the mapping is data: roles.edit saves it; only existing custom roles", async () => {
    expect(
      await actions.saveRoleMap(...as("sec"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await actions.saveRoleMap(...as("boss"))({
        map: { ...SUGGESTED_APPOINTMENT_ROLES, officer: "superadmin" },
        version: null,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("superadmin")] });
    expect(
      await actions.saveRoleMap(...as("boss"))({
        map: { ...SUGGESTED_APPOINTMENT_ROLES, unitHead: "ghost" },
        version: null,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("ghost")] });
    expect(
      await actions.saveRoleMap(...as("boss"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null }),
    ).toEqual({ ok: true, data: { version: 1 } });
    expect(await appointments.getRoleMap()).toMatchObject({
      map: SUGGESTED_APPOINTMENT_ROLES,
      version: 1,
    });
  });

  it("appointing writes the appointment and its period-bound roles in one go", async () => {
    expect(
      await actions.appoint(...as("boss"))(appointInput("ana@example.org", "media", "head")),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("appointment roles")] });
    await actions.saveRoleMap(...as("boss"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null });

    const result = await actions.appoint(...as("boss"))(
      appointInput("ana@example.org", "media", "head", "Direktur Media"),
    );
    expect(result).toMatchObject({ ok: true });
    const id = result.ok ? result.data.id : "";
    expect(await appointments.get(id)).toMatchObject({
      userId: "ana",
      periodId: "p2026",
      orgUnitId: "media",
      seat: "head",
      title: "Direktur Media",
      status: "active",
      startsOn: "2026-11-02",
      endsOn: null,
      name: "ana",
    });
    expect(assignmentsOf("ana")).toEqual([
      {
        roleId: "user",
        scope: { type: "global" },
        periodId: null,
        source: "manual",
        revokedAt: null,
        appointmentId: null,
      },
      {
        roleId: "officer",
        scope: { type: "global" },
        periodId: "p2026",
        source: "appointment",
        revokedAt: null,
        appointmentId: id,
      },
      {
        roleId: "director",
        scope: { type: "orgUnit", orgUnitId: "media" },
        periodId: "p2026",
        source: "appointment",
        revokedAt: null,
        appointmentId: id,
      },
    ]);
    const ana = await principalOf("ana");
    expect(can(ana, "events.edit", { orgUnitPath: ["koor", "media"] })).toBe(true);
    expect(can(ana, "events.edit", { orgUnitPath: ["koor", "finance"] })).toBe(false);
    expect(revokeSessions).toHaveBeenCalledWith("ana");
    expect(logLines.join()).toContain("staff.role_changed");
    const audit = [...fake.docs.entries()]
      .filter(([p]) => p.startsWith("auditLogs/"))
      .map(([, d]) => d);
    expect(audit.slice(-2)).toMatchObject([
      { module: "appointments", action: "CREATE", resourceType: "appointment", resourceId: id },
      { module: "users", action: "UPDATE", resourceId: "ana", revertible: false },
    ]);
    expect((await appointments.listForPeriod("p2026")).map((a) => a.id)).toEqual([id]);

    // Roles bound to the period stop counting when another period is activated.
    fake.docs.set("settings/activePeriod", { periodId: "p2027" });
    expect(can(await principalOf("ana"), "events.edit", { orgUnitPath: ["koor", "media"] })).toBe(
      false,
    );
  });

  it("refuses self-appointment, escalation, a missing second factor, other periods and duplicates", async () => {
    await actions.saveRoleMap(...as("boss"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null });
    const refused = async (uid: string, input: ReturnType<typeof appointInput>, text: string) =>
      expect(await actions.appoint(...as(uid))(input)).toMatchObject({
        error: "refused",
        issues: [expect.stringContaining(text)],
      });
    await refused("boss", appointInput("boss@example.org", "media", "member"), "your own");
    // The Secretary General may appoint, but not into roles holding permissions they lack.
    await refused("sec", appointInput("ana@example.org", "media", "head"), "permissions you hold");
    await refused("boss", appointInput("sec@example.org", "media", "member"), "second sign-in");
    await refused("boss", appointInput("ana@example.org", "old", "member"), "active period");
    await refused("boss", appointInput("nobody@example.org", "media", "member"), "No account");
    expect(
      await actions.appoint(...as("boss"))(appointInput("ana@example.org", "media", "member")),
    ).toMatchObject({ ok: true });
    await refused("boss", appointInput("ana@example.org", "media", "head"), "already");
    fake.docs.delete("roles/director");
    await refused("boss", appointInput("rio@example.org", "media", "head"), "director");
  });

  it("ending an appointment revokes exactly the roles it created and ends the sessions", async () => {
    await actions.saveRoleMap(...as("boss"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null });
    const head = await actions.appoint(...as("boss"))(
      appointInput("ana@example.org", "media", "head"),
    );
    const koor = await actions.appoint(...as("boss"))(
      appointInput("ana@example.org", "koor", "member"),
    );
    const headId = head.ok ? head.data.id : "";
    // A manual director role for the same unit is not the appointment's to take away.
    const ana = await createFirestoreAccountStore(fake.db as unknown as Db).get("ana");
    await createAccountActions({
      accounts: createFirestoreAccountStore(fake.db as unknown as Db),
      roles: createFirestoreRoleStore(fake.db as unknown as Db),
      passkeys: createMemoryPasskeyStore(),
      authAdmin: {
        signInMethods: () => Promise.resolve({ providers: ["google.com"], mfaFactors: 1 }),
        setDisabled: () => Promise.resolve(),
        revokeSessions: () => Promise.resolve(),
      },
      logger: createLogger({ service: "admin", write: () => undefined }),
    }).assignRole(...as("boss"))({
      uid: "ana",
      version: ana?.version ?? 0,
      roleId: "director",
      scope: { type: "orgUnit", orgUnitId: "media" },
    });
    revokeSessions.mockClear();

    expect(await actions.end(...as("boss"))({ id: headId, version: 1, status: "ended" })).toEqual({
      ok: true,
      data: { version: 2 },
    });
    expect(await appointments.get(headId)).toMatchObject({ status: "ended", endsOn: "2026-11-02" });
    const after = assignmentsOf("ana");
    const live = after
      .filter((a) => a["revokedAt"] === null)
      .map((a) => [a["roleId"], a["source"]]);
    expect(live).toEqual([
      ["user", "manual"],
      ["officer", "appointment"], // from the koor appointment
      ["director", "manual"],
    ]);
    expect(
      after.filter((a) => a["appointmentId"] === headId && a["revokedAt"] !== null),
    ).toHaveLength(2);
    expect(revokeSessions).toHaveBeenCalledWith("ana");

    expect(
      await actions.end(...as("boss"))({ id: headId, version: 2, status: "ended" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already ended")] });
    // Nobody ends their own appointment.
    const koorId = koor.ok ? koor.data.id : "";
    fake.docs.set("users/ana", {
      ...fake.docs.get("users/ana"),
      roleAssignments: [
        ...assignmentsOf("ana"),
        { roleId: "superadmin", scope: { type: "global" } },
      ],
    });
    expect(
      await actions.end(...as("ana"))({ id: koorId, version: 1, status: "revoked" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("your own")] });
  });

  it("an appointment role cannot be removed by hand on the Users page", async () => {
    await actions.saveRoleMap(...as("boss"))({ map: SUGGESTED_APPOINTMENT_ROLES, version: null });
    await actions.appoint(...as("boss"))(appointInput("ana@example.org", "media", "head"));
    const accounts = createFirestoreAccountStore(fake.db as unknown as Db);
    const ana = await accounts.get("ana");
    const users = createAccountActions({
      accounts,
      roles: createFirestoreRoleStore(fake.db as unknown as Db),
      passkeys: createMemoryPasskeyStore(),
      authAdmin: {
        signInMethods: () => Promise.resolve({ providers: [], mfaFactors: 0 }),
        setDisabled: () => Promise.resolve(),
        revokeSessions: () => Promise.resolve(),
      },
      logger: createLogger({ service: "admin", write: () => undefined }),
    });
    expect(
      await users.revokeRole(...as("boss"))({
        uid: "ana",
        version: ana?.version ?? 0,
        roleId: "director",
        scope: { type: "orgUnit", orgUnitId: "media" },
        periodId: "p2026",
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("appointment")] });
  });
});
