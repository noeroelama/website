import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicationSnapshot,
  createSqlFormStore,
  createSqlRecruitmentStore,
  createSqlRecruitmentWebStore,
} from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createFormActions } from "../../apps/admin/src/server/forms";
import { createRecruitmentActions } from "../../apps/admin/src/server/recruitment";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlFormStore>[0];
let clock = new Date("2026-11-10T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "committee-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const committee = staff(["recruitment.edit", "forms.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeDb>;
let saved: Array<{ path: string; bytes: Uint8Array; options: unknown }>;
const db = () => fake.db as unknown as Db;
const recruitmentActions = () =>
  createRecruitmentActions({
    recruitments: createSqlRecruitmentStore(db()),
    now: () => clock,
  });
const web = () => createSqlRecruitmentWebStore(db());
const applying = () =>
  createApplying({
    store: web(),
    profileComplete: (uid) => Promise.resolve(uid !== "incomplete"),
    storage: {
      save: vi.fn((path: string, bytes: Uint8Array, options: unknown) => {
        saved.push({ path, bytes, options });
        return Promise.resolve({ url: null });
      }),
    },
    now: () => clock,
    uuid: () => "abcdef12-0000-4000-8000-000000000000",
  });

const ari = { uid: "ari" };
const budi = { uid: "budi" };
let formId = "";
let questionId = "";
let recruitmentId = "";

const setup = {
  periodId: "p2026",
  title: "Oprec 2026",
  description: "Join the board.",
  opensAt: "2026-11-01T00:00:00.000Z",
  closesAt: "2026-11-20T00:00:00.000Z",
  maxChoices: 2,
  offerDays: 3,
  formId: "",
  units: [
    { orgUnitId: "media", quota: 2, portfolioRequired: true },
    { orgUnitId: "finance", quota: 1, portfolioRequired: false },
  ],
};
const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF");
const upload = (
  user: { uid: string } | null,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
) =>
  applying().uploadFile(
    user,
    recruitmentId,
    null,
    new Request("https://web.test/api/recruitment/x/portfolio", {
      method: "POST",
      body: bytes,
      headers: { "x-file-name": encodeURIComponent("Ari portfolio.pdf"), ...headers },
    }),
  );
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(async () => {
  clock = new Date("2026-11-10T05:00:00Z");
  saved = [];
  fake = fakeDb();
  fake.docs.set("periods/p2026", { name: "2026/2027", status: "active", deletedAt: null });
  fake.docs.set("periods/p2025", { name: "2025/2026", status: "archived", deletedAt: null });
  fake.docs.set("orgUnits/media", { periodId: "p2026", name: "Direktorat Media", deletedAt: null });
  fake.docs.set("orgUnits/finance", { periodId: "p2026", name: "Keuangan", deletedAt: null });
  fake.docs.set("orgUnits/old", { periodId: "p2025", name: "Old unit", deletedAt: null });
  const form = await createFormActions({
    forms: createSqlFormStore(db()),
    now: () => clock,
    uuid: () => "11111111-0000-4000-8000-000000000000",
    token: () => "unused-token-0000000000000",
    logExport: () => undefined,
  }).save(...as(committee))({
    title: "Oprec questions",
    description: "",
    usage: "recruitment",
    opensAt: null,
    closesAt: null,
    questions: [
      {
        id: "",
        type: "long_text",
        label: "Why do you want to join?",
        description: "",
        required: true,
        options: [],
        allowOther: false,
        maxSelections: null,
        min: null,
        max: null,
      },
    ],
    version: null,
  });
  formId = form.ok ? form.data.id : "";
  questionId = "q_11111111";
  const created = await recruitmentActions().save(...as(committee))({
    ...setup,
    formId,
    version: null,
  });
  if (!created.ok) throw new Error(JSON.stringify(created));
  recruitmentId = created.data.id;
  await recruitmentActions().setPublished(...as(committee))({
    id: recruitmentId,
    version: 1,
    published: true,
  });
});

describe("recruitment set-up (recruitment.edit)", () => {
  it("stores units with name snapshots and one seat counter per unit", async () => {
    expect(
      await recruitmentActions().save(...as(staff(["recruitment.review"])))({
        ...setup,
        formId,
        version: null,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    const r = await createSqlRecruitmentStore(db()).get(recruitmentId);
    expect(r).toMatchObject({
      formId,
      formVersion: 1,
      published: true,
      units: [
        { orgUnitId: "media", name: "Direktorat Media", quota: 2, portfolioRequired: true },
        { orgUnitId: "finance", name: "Keuangan", quota: 1, portfolioRequired: false },
      ],
    });
    expect(fake.docs.get(`seatCounters/${recruitmentId}_media`)).toMatchObject({
      quota: 2,
      filled: 0,
    });
    expect(r).not.toBeNull();
    const seats = await createSqlRecruitmentStore(db()).seats([recruitmentId]);
    expect([...(seats.get(recruitmentId) ?? new Map()).entries()]).toEqual([
      ["media", { quota: 2, filled: 0 }],
      ["finance", { quota: 1, filled: 0 }],
    ]);
    expect(
      auditEntries()
        .map((e) => e["action"])
        .slice(-2),
    ).toEqual(["CREATE", "PUBLISH"]);
  });

  it("refuses public forms, units of another period and archived periods", async () => {
    const save = (patch: Record<string, unknown>) =>
      recruitmentActions().save(...as(committee))({ ...setup, formId, version: null, ...patch });
    fake.docs.set("forms/public", { usage: "public", currentVersion: 1, deletedAt: null });
    expect(await save({ formId: "public" })).toMatchObject({
      error: "refused",
      issues: ["Choose a recruitment form."],
    });
    expect(
      await save({ units: [{ orgUnitId: "old", quota: 1, portfolioRequired: false }] }),
    ).toMatchObject({ error: "refused", issues: ["Choose units of this board period."] });
    expect(await save({ periodId: "p2025" })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("archived")],
    });
    expect(await save({ periodId: "nope" })).toMatchObject({ error: "refused" });
  });

  it("never lowers a quota below the seats taken, nor drops a unit with taken seats", async () => {
    fake.docs.set(`seatCounters/${recruitmentId}_media`, {
      recruitmentId,
      orgUnitId: "media",
      quota: 2,
      filled: 2,
    });
    const edit = (units: typeof setup.units) =>
      recruitmentActions().save(...as(committee))({
        ...setup,
        formId,
        units,
        id: recruitmentId,
        version: 2,
      });
    expect(await edit([{ orgUnitId: "media", quota: 1, portfolioRequired: true }])).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("Direktorat Media")],
    });
    expect(
      await edit([{ orgUnitId: "finance", quota: 1, portfolioRequired: false }]),
    ).toMatchObject({
      error: "refused",
      issues: ["Direktorat Media has accepted seats; keep it."],
    });
    expect(
      await edit([
        { orgUnitId: "media", quota: 3, portfolioRequired: true },
        { orgUnitId: "finance", quota: 1, portfolioRequired: false },
      ]),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(fake.docs.get(`seatCounters/${recruitmentId}_media`)).toMatchObject({
      quota: 3,
      filled: 2,
    });
    await recruitmentActions().save(...as(committee))({
      ...setup,
      formId,
      units: [{ orgUnitId: "media", quota: 3, portfolioRequired: true }],
      id: recruitmentId,
      version: 3,
    });
    expect(fake.docs.has(`seatCounters/${recruitmentId}_finance`)).toBe(false);
  });
});

describe("applying (C3 steps 1-2)", () => {
  it("needs a session and a complete profile", async () => {
    const input = { recruitmentId, choices: ["finance"], answers: {} };
    expect(await applying().saveDraft(null, input)).toEqual({ ok: false, error: "signin" });
    expect(await applying().saveDraft({ uid: "incomplete" }, input)).toEqual({
      ok: false,
      error: "profile",
    });
    expect(await applying().saveDraft(ari, { ...input, recruitmentId: "a/b" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("saves a draft, then submits ONE application per person ({recruitmentId}_{uid})", async () => {
    expect(
      await applying().saveDraft(ari, { recruitmentId, choices: ["finance"], answers: {} }),
    ).toEqual({ ok: true, status: "draft", version: 1 });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "answers",
      fields: { [questionId]: "This question is required." },
    });
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: ["finance"],
      answers: { [questionId]: "I like numbers." },
    });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({
      ok: true,
      status: "submitted",
      version: 3,
    });
    expect(fake.docs.get(`applications/${recruitmentId}_ari`)).toMatchObject({
      userId: "ari",
      status: "submitted",
      choices: ["finance"],
      answers: { [questionId]: "I like numbers." },
    });
    expect(fake.docs.get(`formVersions/${formId}_1`)).toMatchObject({ answered: true });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({ ok: false, error: "locked" });
    expect(
      await applying().saveDraft(ari, { recruitmentId, choices: ["media"], answers: {} }),
    ).toEqual({ ok: false, error: "locked" });
    const entry = auditEntries().at(-1);
    expect(entry).toMatchObject({
      actor: { type: "member", id: "ari" },
      resourceType: "application",
    });
    expect(JSON.stringify(entry)).not.toContain("I like numbers.");
  });

  it("an applicant only ever reads and writes their own application", async () => {
    await applying().saveDraft(ari, { recruitmentId, choices: ["finance"], answers: {} });
    expect(await web().ownApplication(recruitmentId, "budi")).toBeNull();
    await applying().saveDraft(budi, { recruitmentId, choices: ["media"], answers: {} });
    expect((await web().ownApplication(recruitmentId, "ari"))?.choices).toEqual(["finance"]);
    expect((await web().ownApplication(recruitmentId, "budi"))?.choices).toEqual(["media"]);
    expect(await web().ownApplication("../x", "ari")).toBeNull();
  });

  it("checks choices against the recruitment (count, units, order)", async () => {
    for (const choices of [["media", "finance", "media"], ["sports"], ["media", "media"]]) {
      expect(
        await applying().saveDraft(ari, { recruitmentId, choices, answers: {} }),
        JSON.stringify(choices),
      ).toMatchObject({ ok: false, error: "refused" });
    }
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: [],
      answers: { [questionId]: "Hi" },
    });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "refused",
      message: "Choose at least one unit.",
    });
  });

  it("asks for a portfolio only for flagged units; PDF only, private, at most 5 MB", async () => {
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: ["media", "finance"],
      answers: { [questionId]: "Design!" },
    });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "refused",
      message: "Upload your portfolio (PDF).",
    });
    expect((await upload(null, pdf)).status).toBe(401);
    expect((await upload({ uid: "incomplete" }, pdf)).status).toBe(400);
    expect(await (await upload(ari, new TextEncoder().encode("<html>"))).json()).toEqual({
      error: "not_pdf",
    });
    expect((await upload(ari, pdf, { "content-length": String(6 * 1024 * 1024) })).status).toBe(
      413,
    );
    const ok = await upload(ari, pdf);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ ok: true, name: "Ari portfolio.pdf" });
    expect(saved).toEqual([
      {
        path: `recruitment/${recruitmentId}/ari/portfolio_${clock.getTime()}_abcdef12.pdf`,
        bytes: pdf,
        options: { visibility: "private", contentType: "application/pdf" },
      },
    ]);
    expect(await applying().submit(ari, { recruitmentId })).toMatchObject({ ok: true });
    expect(await (await upload(budi, pdf, { "x-file-name": "%E0%A4%A" })).json()).toEqual({
      ok: true,
      name: "portfolio.pdf",
    });
    await applying().saveDraft(
      { uid: "cici" },
      {
        recruitmentId,
        choices: ["finance"],
        answers: { [questionId]: "Numbers" },
      },
    );
    expect(await applying().submit({ uid: "cici" }, { recruitmentId })).toMatchObject({ ok: true });
  });

  it("refuses everything outside the window or when unpublished", async () => {
    clock = new Date("2026-11-20T00:00:00Z");
    expect(
      await applying().saveDraft(ari, { recruitmentId, choices: ["finance"], answers: {} }),
    ).toEqual({ ok: false, error: "closed" });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({ ok: false, error: "closed" });
    expect((await upload(ari, pdf)).status).toBe(400);
    const late = await applying().uploadFile(
      ari,
      recruitmentId,
      "q_late",
      new Request("https://web.test/x", { method: "POST", body: pdf }),
    );
    expect(await late.json()).toEqual({ ok: false, error: "closed" });
    clock = new Date("2026-11-10T05:00:00Z");
    await recruitmentActions().setPublished(...as(committee))({
      id: recruitmentId,
      version: 2,
      published: false,
    });
    expect(await web().getPublished(recruitmentId)).toBeNull();
    expect(await web().getVisible(recruitmentId)).toMatchObject({ published: false });
    expect(await applying().withdraw(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "locked",
    });
    expect(await (await upload(ari, pdf)).json()).toEqual({ ok: false, error: "closed" });
    expect(await web().getVisible("a/b")).toBeNull();
    expect(await web().getVisible("missing")).toBeNull();
    expect(await web().getPublished("a/b")).toBeNull();
    expect(await web().listPublished()).toEqual([]);
    await recruitmentActions().remove(...as(committee))({ id: recruitmentId, version: 3 });
    expect(await web().getVisible(recruitmentId)).toBeNull();
    expect(await (await upload(ari, pdf)).json()).toEqual({ error: "closed" });
  });

  it("withdraws before a seat is taken", async () => {
    expect(await applying().withdraw(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "locked",
    });
    await applying().saveDraft(ari, { recruitmentId, choices: ["finance"], answers: {} });
    expect(await applying().withdraw(ari, { recruitmentId })).toMatchObject({
      ok: true,
      status: "withdrawn",
    });
    expect(
      await applying().saveDraft(ari, { recruitmentId, choices: ["finance"], answers: {} }),
    ).toEqual({ ok: false, error: "locked" });
    expect((await web().listPublished()).map((r) => r.id)).toEqual([recruitmentId]);
    expect(await web().questions((await web().getPublished(recruitmentId))!)).toHaveLength(1);
  });
});

describe("edge cases kept safe", () => {
  it("set-up: missing, stale, deleted, moved between periods; list and delete (revertible)", async () => {
    const store = createSqlRecruitmentStore(db());
    const save = (patch: Record<string, unknown>) =>
      recruitmentActions().save(...as(committee))({ ...setup, formId, ...patch });
    expect(await save({ id: "missing", version: 1 })).toMatchObject({ error: "refused" });
    expect(await save({ id: recruitmentId, version: 9 })).toMatchObject({ error: "conflict" });
    fake.docs.set("periods/p2027", { name: "2027/2028", status: "draft", deletedAt: null });
    expect(await save({ id: recruitmentId, version: 2, periodId: "p2027" })).toMatchObject({
      error: "refused",
      issues: ["A recruitment stays in its board period."],
    });
    fake.docs.delete(`seatCounters/${recruitmentId}_finance`);
    expect(
      await save({
        id: recruitmentId,
        version: 2,
        units: [{ orgUnitId: "media", quota: 2, portfolioRequired: true }],
      }),
    ).toMatchObject({ ok: true });
    const second = await save({
      version: null,
      title: "Oprec susulan",
      opensAt: "2026-12-01T00:00:00.000Z",
      closesAt: "2026-12-10T00:00:00.000Z",
    });
    const secondId = second.ok ? second.data.id : "";
    await recruitmentActions().setPublished(...as(committee))({
      id: secondId,
      version: 1,
      published: true,
    });
    expect((await store.listForAdmin()).map((r) => r.title)).toEqual([
      "Oprec susulan",
      "Oprec 2026",
    ]);
    expect((await web().listPublished()).map((r) => r.title)).toEqual([
      "Oprec susulan",
      "Oprec 2026",
    ]);
    expect(
      await recruitmentActions().remove(...as(staff(["recruitment.read"])))({
        id: secondId,
        version: 2,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await recruitmentActions().remove(...as(committee))({ id: secondId, version: 2 }),
    ).toMatchObject({
      ok: true,
    });
    expect(auditEntries().at(-1)).toMatchObject({ action: "DELETE", revertible: true });
    expect((await store.listForAdmin()).map((r) => r.title)).toEqual(["Oprec 2026"]);
    expect(await save({ id: secondId, version: 3 })).toMatchObject({
      issues: ["This item is in the trash."],
    });
  });

  it("applying: unknown recruitment, missing questions, bad answers, uploads after submitting", async () => {
    expect(
      await applying().saveDraft(ari, { recruitmentId: "missing", choices: [], answers: {} }),
    ).toEqual({ ok: false, error: "closed" });
    expect(await web().getPublished("missing")).toBeNull();
    expect(await applying().submit(null, { recruitmentId })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(await applying().withdraw(null, { recruitmentId })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await applying().saveDraft(ari, { recruitmentId, choices: [], answers: { q_unknown: "x" } }),
    ).toEqual({ ok: false, error: "answers", fields: { form: "Unknown question." } });
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: ["finance"],
      answers: { [questionId]: "Hi" },
    });
    await applying().submit(ari, { recruitmentId });
    expect(await (await upload(ari, pdf, { "x-file-name": "" })).json()).toEqual({
      ok: false,
      error: "locked",
    });
    const noName = await applying().uploadFile(
      budi,
      recruitmentId,
      null,
      new Request("https://web.test/x", { method: "POST", body: pdf }),
    );
    expect(await noName.json()).toEqual({ ok: true, name: "portfolio.pdf" });
    fake.docs.delete(`formVersions/${formId}_1`);
    const r = await web().getPublished(recruitmentId);
    expect(await web().questions(r!)).toEqual([]);
    expect(
      await applying().saveDraft({ uid: "cici" }, { recruitmentId, choices: [], answers: {} }),
    ).toMatchObject({ ok: true });
  });

  it("reads stored offers; the audit summary never holds answers", async () => {
    const expiresAt = new Date("2026-11-13T00:00:00Z");
    fake.docs.set(`applications/${recruitmentId}_ari`, {
      recruitmentId,
      userId: "ari",
      status: "offered",
      choices: ["media"],
      answers: { [questionId]: "secret" },
      revisionRound: 0,
      offer: { orgUnitId: "media", expiresAt },
      submittedAt: clock,
      version: 4,
      createdAt: clock,
      updatedAt: clock,
    });
    const application = await web().ownApplication(recruitmentId, "ari");
    expect(application).toMatchObject({
      offer: { orgUnitId: "media", expiresAt },
      portfolio: null,
    });
    expect(applicationSnapshot(application!)).toEqual({
      status: "offered",
      choices: ["media"],
      revisionRound: 0,
      offer: { orgUnitId: "media", expiresAt: "2026-11-13T00:00:00.000Z" },
      portfolio: null,
      pacts: [],
      appointmentId: null,
    });
    expect(
      applicationSnapshot({
        ...application!,
        offer: null,
        portfolio: { path: "p", name: "cv.pdf", contentType: "application/pdf", size: 1 },
      }),
    ).toMatchObject({ offer: null, portfolio: "cv.pdf" });
  });
});

describe("file questions in the recruitment form", () => {
  it("stores an uploaded PDF as the answer and requires it on submit", async () => {
    const version = fake.docs.get(`formVersions/${formId}_1`) as { questions: unknown[] };
    fake.docs.set(`formVersions/${formId}_1`, {
      ...version,
      questions: [
        ...version.questions,
        {
          id: "q_cv",
          type: "file",
          label: "CV",
          description: "",
          required: true,
          options: [],
          allowOther: false,
          maxSelections: null,
          min: null,
          max: null,
        },
      ],
    });
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: ["finance"],
      answers: { [questionId]: "Hi" },
    });
    expect(await applying().submit(ari, { recruitmentId })).toEqual({
      ok: false,
      error: "answers",
      fields: { q_cv: "This question is required." },
    });
    const send = (question: string) =>
      applying().uploadFile(
        ari,
        recruitmentId,
        question,
        new Request("https://web.test/x", {
          method: "POST",
          body: pdf,
          headers: { "x-file-name": "cv.pdf" },
        }),
      );
    expect((await send("../../x")).status).toBe(400);
    expect(await (await send("q_unknown")).json()).toEqual({
      ok: false,
      error: "refused",
      message: "Unknown question.",
    });
    expect(await (await send("q_cv")).json()).toEqual({ ok: true, name: "cv.pdf" });
    expect(saved.at(-1)?.path).toBe(`forms/${formId}/ari_${clock.getTime()}_abcdef12.pdf`);
    expect((await web().ownApplication(recruitmentId, "ari"))?.answers["q_cv"]).toMatchObject({
      name: "cv.pdf",
      contentType: "application/pdf",
    });
    const kept = (await web().ownApplication(recruitmentId, "ari"))?.answers["q_cv"];
    await applying().saveDraft(ari, {
      recruitmentId,
      choices: ["finance"],
      answers: {
        [questionId]: "Hi",
        q_cv: {
          path: `forms/${formId}/budi_1.pdf`,
          name: "x.pdf",
          contentType: "application/pdf",
          size: 1,
        },
      },
    });
    expect((await web().ownApplication(recruitmentId, "ari"))?.answers["q_cv"]).toEqual(kept);
    expect(await applying().submit(ari, { recruitmentId })).toMatchObject({ ok: true });
    expect(await (await send("q_cv")).json()).toMatchObject({ error: "locked" });
    const unnamed = await applying().uploadFile(
      budi,
      recruitmentId,
      "q_cv",
      new Request("https://web.test/x", { method: "POST", body: pdf }),
    );
    expect(await unnamed.json()).toEqual({ ok: true, name: "file.pdf" });
  });
});
