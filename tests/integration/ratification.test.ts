import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFirestoreApplicationStore,
  createFirestoreAppointmentStore,
  createFirestoreOrgUnitStore,
  createFirestoreRecruitmentWebStore,
  createFirestoreRoleStore,
  createFirestoreUserStore,
} from "@website/db/firestore";
import { SUGGESTED_APPOINTMENT_ROLES } from "@website/domain/organizations";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createApplicationActions } from "../../apps/admin/src/server/applications";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreApplicationStore>[0];
let clock = new Date("2026-11-25T05:00:00Z");
const role = (permissions: string[]) => ({
  name: "Role",
  permissions: normalizePermissions(permissions),
  version: 1,
  deletedAt: null,
});
const user = (uid: string, roleIds: string[]) => ({
  uid,
  email: `${uid}@example.org`,
  name: uid,
  status: "active",
  version: 1,
  roleAssignments: roleIds.map((roleId) => ({ roleId, scope: { type: "global" } })),
  roleIds,
});

let fake: ReturnType<typeof fakeFirestore>;
let secondFactor: Record<string, boolean>;
let afterRoleChange: ReturnType<typeof vi.fn>;
const db = () => fake.db as unknown as Db;
const principalOf = async (uid: string) =>
  (await createFirestoreUserStore(db()).findPrincipalByUid(uid)) as Principal;
const context = () =>
  Promise.resolve({
    actorEmail: "x@example.org",
    requestId: "req-123456",
    authTime: Date.now() / 1000,
  });
const as = (uid: string) => [() => principalOf(uid), context] as const;
const actions = () =>
  createApplicationActions({
    applications: createFirestoreApplicationStore(db()),
    signedUrl: (path) => Promise.resolve(`https://signed.test/${path}`),
    appointments: createFirestoreAppointmentStore(db()),
    units: createFirestoreOrgUnitStore(db()),
    roles: createFirestoreRoleStore(db()),
    hasSecondFactor: (uid) => Promise.resolve(secondFactor[uid] ?? false),
    afterRoleChange: afterRoleChange as unknown as (
      actor: Principal,
      uid: string,
      details: object,
    ) => Promise<void>,
    now: () => clock,
  });
const applying = () =>
  createApplying({
    store: createFirestoreRecruitmentWebStore(db()),
    profileComplete: () => Promise.resolve(true),
    storage: { save: () => Promise.resolve({ url: null }) },
    now: () => clock,
    uuid: () => "abcdef12-0000-4000-8000-000000000000",
  });
const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF");
const uploadPact = () =>
  applying().uploadFile(
    { uid: "ari" },
    "rec1",
    "pact",
    new Request("https://web.test/x", {
      method: "POST",
      body: pdf,
      headers: { "x-file-name": "pakta.pdf" },
    }),
  );
const app = () => fake.docs.get("applications/rec1_ari") as Record<string, unknown>;
const appointments = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("appointments/")).map(([, d]) => d);
const setApplication = (status: string, extra: Record<string, unknown> = {}) =>
  fake.docs.set("applications/rec1_ari", {
    recruitmentId: "rec1",
    userId: "ari",
    status,
    choices: ["media"],
    answers: {},
    revisionRound: 0,
    offer: { orgUnitId: "media", expiresAt: new Date("2026-11-20T00:00:00Z") },
    interview: null,
    pacts: [],
    pactNote: null,
    appointmentId: null,
    submittedAt: clock,
    version: 5,
    createdAt: clock,
    updatedAt: clock,
    ...extra,
  });

beforeEach(() => {
  clock = new Date("2026-11-25T05:00:00Z");
  fake = fakeFirestore();
  secondFactor = { ari: true };
  afterRoleChange = vi.fn(() => Promise.resolve());
  fake.docs.set("settings/activePeriod", { periodId: "p2026" });
  fake.docs.set("periods/p2026", { status: "active" });
  fake.docs.set("settings/appointmentRoles", { map: SUGGESTED_APPOINTMENT_ROLES, version: 1 });
  fake.docs.set("orgUnits/media", {
    periodId: "p2026",
    parentId: null,
    path: [],
    name: "Direktorat Media",
    code: "MED",
    type: "direktorat",
    description: "",
    sort: 0,
    active: true,
    version: 1,
    createdAt: clock.toISOString(),
    updatedAt: clock.toISOString(),
    deletedAt: null,
  });
  fake.docs.set("recruitments/rec1", {
    periodId: "p2026",
    title: "Oprec 2026",
    description: "",
    opensAt: "2026-11-01T00:00:00.000Z",
    closesAt: "2026-11-20T00:00:00.000Z",
    maxChoices: 1,
    units: [{ orgUnitId: "media", name: "Direktorat Media", quota: 2, portfolioRequired: false }],
    offerDays: 3,
    formId: "form1",
    formVersion: 1,
    pactTemplateUrl: "https://drive.example/pakta",
    published: true,
    version: 2,
    deletedAt: null,
  });
  fake.docs.set("roles/officer", role(["events.read", "structure.read"]));
  fake.docs.set("roles/sekjen", role(["recruitment.confirm", "events.read", "structure.read"]));
  fake.docs.set("roles/committee", role(["recruitment.review"]));
  fake.docs.set("users/sekjen", user("sekjen", ["sekjen"]));
  fake.docs.set("users/panitia", user("panitia", ["committee"]));
  fake.docs.set("users/ari", user("ari", ["user"]));
});

describe("placement approval and integrity pact (C3 steps 7-8)", () => {
  it("only recruitment.confirm (the Sekjen) approves a placement", async () => {
    setApplication("accepted");
    expect(await actions().approve(...as("panitia"))({ id: "rec1_ari", version: 5 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await actions().approve(...as("sekjen"))({ id: "rec1_ari", version: 5 })).toMatchObject({
      ok: true,
      data: { status: "approved" },
    });
  });

  it("the applicant uploads the signed pact; sending it back keeps every file", async () => {
    setApplication("approved");
    expect(await (await uploadPact()).json()).toEqual({ ok: true, name: "pakta.pdf" });
    expect(app()).toMatchObject({ status: "pakta_review", pactNote: null });
    expect(
      await actions().returnPact(...as("panitia"))({
        id: "rec1_ari",
        version: 6,
        note: "Sign on page 2 too.",
      }),
    ).toMatchObject({ ok: true, data: { status: "approved" } });
    expect(app()).toMatchObject({ pactNote: "Sign on page 2 too." });
    clock = new Date("2026-11-26T05:00:00Z");
    await uploadPact();
    const pacts = app()["pacts"] as Array<{ path: string }>;
    expect(pacts.map((p) => p.path)).toEqual([
      `recruitment/rec1/ari/pact_${new Date("2026-11-25T05:00:00Z").getTime()}_abcdef12.pdf`,
      `recruitment/rec1/ari/pact_${clock.getTime()}_abcdef12.pdf`,
    ]);
    expect(app()).toMatchObject({ status: "pakta_review", pactNote: null });
    // Both files stay readable for the committee.
    for (const { path } of pacts) {
      expect(await actions().fileUrl(...as("panitia"))({ id: "rec1_ari", path })).toMatchObject({
        ok: true,
      });
    }
    // A pact can only be uploaded once the placement is approved.
    expect(await (await uploadPact()).json()).toMatchObject({ ok: false, error: "locked" });
  });
});

describe("ratification (C3 step 9)", () => {
  it("confirms and appoints in ONE transaction, once; roles come from the appointment", async () => {
    setApplication("pakta_review");
    // An account without an e-mail is filed under its uid in the audit log.
    fake.docs.set("users/ari", { ...user("ari", ["user"]), email: null });
    expect(
      await actions().ratify(...as("sekjen"))({ id: "rec1_ari", version: 4, title: "Staf Media" }),
    ).toMatchObject({ ok: false, error: "conflict" });
    expect(
      await actions().ratify(...as("panitia"))({ id: "rec1_ari", version: 5, title: "Staf Media" }),
    ).toEqual({ ok: false, error: "forbidden" });
    const ratified = await actions().ratify(...as("sekjen"))({
      id: "rec1_ari",
      version: 5,
      title: "Staf Direktorat Media",
    });
    expect(ratified).toMatchObject({ ok: true, data: { status: "confirmed" } });
    const appointmentId = ratified.ok ? ratified.data.appointmentId : "";
    expect(app()).toMatchObject({ status: "confirmed", appointmentId });
    expect(appointments()).toEqual([
      expect.objectContaining({
        userId: "ari",
        orgUnitId: "media",
        seat: "member",
        title: "Staf Direktorat Media",
        periodId: "p2026",
        status: "active",
      }),
    ]);
    const assignments = fake.docs.get("users/ari")?.["roleAssignments"] as Array<
      Record<string, unknown>
    >;
    expect(assignments).toContainEqual(
      expect.objectContaining({ roleId: "officer", source: "appointment", appointmentId }),
    );
    expect(afterRoleChange).toHaveBeenCalledWith(expect.anything(), "ari", {
      appointment: appointmentId,
      application: "rec1_ari",
    });
    // Ratifying again is refused: confirmed is final, and there is still one appointment.
    expect(
      await actions().ratify(...as("sekjen"))({ id: "rec1_ari", version: 6, title: "Staf" }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(appointments()).toHaveLength(1);
    const modules = [...fake.docs.entries()]
      .filter(([p]) => p.startsWith("auditLogs/"))
      .map(([, d]) => d["module"]);
    expect(modules.sort()).toEqual(["appointments", "recruitment", "users"]);
  });

  it("refuses: own application, no second sign-in method, escalation, inactive period", async () => {
    setApplication("pakta_review");
    const ratify = (uid: string) =>
      actions().ratify(...as(uid))({ id: "rec1_ari", version: 5, title: "Staf Direktorat Media" });
    // The ratifier must hold the permissions of the roles given.
    fake.docs.set("roles/officer", role(["events.read", "members.pii"]));
    expect(await ratify("sekjen")).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("permissions you hold")],
    });
    fake.docs.set("roles/officer", role(["events.read", "structure.read"]));
    secondFactor = {};
    expect(await ratify("sekjen")).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("second sign-in method")],
    });
    secondFactor = { ari: true };
    // The board period of the unit is no longer the active one.
    fake.docs.set("settings/activePeriod", { periodId: "p2027" });
    expect(await ratify("sekjen")).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("active period")],
    });
    expect(app()).toMatchObject({ status: "pakta_review", appointmentId: null });
    expect(appointments()).toHaveLength(0);
    // Nobody ratifies their own application.
    fake.docs.set("applications/rec1_sekjen", { ...app(), userId: "sekjen" });
    expect(
      await actions().ratify(...as("sekjen"))({ id: "rec1_sekjen", version: 5, title: "Staf" }),
    ).toMatchObject({ error: "refused", issues: ["You cannot ratify your own application."] });
  });

  it("needs a placement, the role map and the unit", async () => {
    const ratify = () =>
      actions().ratify(...as("sekjen"))({ id: "rec1_ari", version: 5, title: "Staf" });
    expect(await ratify()).toMatchObject({ issues: ["This application has no placement."] });
    setApplication("pakta_review");
    fake.docs.delete("settings/appointmentRoles");
    expect(await ratify()).toMatchObject({
      issues: [expect.stringContaining("appointment roles")],
    });
    fake.docs.set("settings/appointmentRoles", { map: SUGGESTED_APPOINTMENT_ROLES, version: 1 });
    fake.docs.delete("roles/officer");
    expect(await ratify()).toMatchObject({ issues: ['The role "officer" does not exist.'] });
    fake.docs.delete("orgUnits/media");
    expect(await ratify()).toMatchObject({ issues: ["This unit does not exist."] });
    fake.docs.set("roles/officer", role(["events.read"]));
    expect(await ratify()).toMatchObject({ ok: false });
    expect(
      await actions().ratify(...as("sekjen"))({ id: "missing", version: 1, title: "Staf" }),
    ).toMatchObject({ error: "refused" });
    // The store re-reads the application inside its transaction.
    await expect(
      createFirestoreApplicationStore(db()).ratify(
        "missing",
        1,
        { title: "Staf" },
        [],
        { appointment: () => [], application: () => ({}) as never },
        clock,
      ),
    ).rejects.toThrow("This application does not exist.");
  });
});
