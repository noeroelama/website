import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreFormStore, createFirestoreFormWebStore } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createFormActions } from "../../apps/admin/src/server/forms";
import { createFormSubmission, createPublicFormReader } from "../../apps/web/src/server/forms";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreFormStore>[0];
let clock = new Date("2026-10-20T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const owner = staff(["forms.edit", "forms.publish", "forms.export"]);
const context = () =>
  Promise.resolve({ actorEmail: "forms@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const question = (extra: Record<string, unknown> = {}) => ({
  id: "",
  type: "short_text",
  label: "Full name",
  description: "",
  required: true,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const formInput = (extra: Record<string, unknown> = {}) => ({
  title: "Feedback Kongres 2026",
  description: "",
  usage: "public",
  opensAt: null,
  closesAt: null,
  questions: [
    question(),
    question({ type: "single_choice", label: "Rating", options: ["Good", "Bad"] }),
  ],
  ...extra,
});

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestoreFormStore>;
let web: ReturnType<typeof createFirestoreFormWebStore>;
let tokens = 0;
const securityEvents: Array<{ actorId: string; details: Record<string, unknown> }> = [];
const actions = () =>
  createFormActions({
    forms: store,
    now: () => clock,
    uuid: () => crypto.randomUUID(),
    token: () => `token${String(++tokens).padStart(20, "0")}`,
    logExport: (actorId, details) => securityEvents.push({ actorId, details }),
  });
const captcha = vi.fn((token: string) => Promise.resolve(token === "human"));
const submit = (input: unknown) =>
  createFormSubmission({
    submit: (token, version, answers, now) => web.submit(token, version, answers, now),
    captcha,
    now: () => clock,
  })(input);
const reader = () => createPublicFormReader({ find: (token) => web.findPublic(token, clock) });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const responses = () => [...fake.docs.keys()].filter((p) => p.startsWith("formResponses/"));

/** A published public form; returns its id, entity version and public token. */
const published = async (extra: Record<string, unknown> = {}) => {
  const saved = await actions().save(...as(owner))({ ...formInput(extra), version: null });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const result = await actions().publish(...as(owner))({ id: saved.data.id, version: 1 });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { id: saved.data.id, ...result.data };
};
const questionIds = async (formId: string, n = 1) =>
  ((await store.getVersion(formId, n))?.questions ?? []).map((q) => q.id);

beforeEach(() => {
  clock = new Date("2026-10-20T05:00:00Z");
  tokens = 0;
  securityEvents.length = 0;
  captcha.mockClear();
  fake = fakeFirestore();
  store = createFirestoreFormStore(fake.db as unknown as Db);
  web = createFirestoreFormWebStore(fake.db as unknown as Db);
});

describe("publishing a form (forms.publish)", () => {
  it("needs forms.publish; creates the random token once; audited", async () => {
    const saved = await actions().save(...as(owner))({ ...formInput(), version: null });
    const id = saved.ok ? saved.data.id : "";
    expect(await actions().publish(...as(staff(["forms.edit"])))({ id, version: 1 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await actions().publish(...as(owner))({ id, version: 1 })).toEqual({
      ok: true,
      data: { version: 2, publicToken: "token00000000000000000001" },
    });
    expect(auditEntries().at(-1)).toMatchObject({ action: "PUBLISH", revertible: false });
    expect(await actions().close(...as(owner))({ id, version: 2 })).toMatchObject({ ok: true });
    expect(await store.get(id)).toMatchObject({ status: "closed" });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UNPUBLISH", revertible: false });
    // Re-opening keeps the printed link working: same token.
    expect(await actions().publish(...as(owner))({ id, version: 3 })).toMatchObject({
      data: { publicToken: "token00000000000000000001" },
    });
    expect(await actions().close(...as(owner))({ id, version: 4 })).toMatchObject({ ok: true });
    expect(await actions().close(...as(owner))({ id, version: 5 })).toMatchObject({
      error: "refused",
      issues: ["Only a published form can be closed."],
    });
  });

  it("never publishes recruitment forms or forms with file questions", async () => {
    const recruitment = await actions().save(...as(owner))({
      ...formInput({ usage: "recruitment" }),
      version: null,
    });
    expect(
      await actions().publish(...as(owner))({
        id: recruitment.ok ? recruitment.data.id : "",
        version: 1,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("application")] });
    const withFile = await actions().save(...as(owner))({
      ...formInput({ questions: [question({ type: "file", label: "CV" })] }),
      version: null,
    });
    expect(
      await actions().publish(...as(owner))({
        id: withFile.ok ? withFile.data.id : "",
        version: 1,
      }),
    ).toMatchObject({ error: "refused", issues: ["Public forms cannot ask for files."] });
  });
});

describe("answering at /f/{token} (C2)", () => {
  it("shows the form without ids; unknown, draft and recruitment tokens are not found", async () => {
    const { publicToken, id } = await published();
    expect(await reader()(publicToken)).toMatchObject({
      state: "open",
      form: { title: "Feedback Kongres 2026", version: 1 },
    });
    expect(JSON.stringify(await reader()(publicToken))).not.toContain(id);
    expect(await reader()("tokenUnknown0000000000000")).toBeNull();
    expect(await reader()("../forms")).toBeNull();
    // A recruitment form that somehow has a token is still not reachable here.
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), usage: "recruitment" });
    expect(await reader()(publicToken)).toBeNull();
  });

  it("stores a valid response, freezes the version and counts it", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Good" },
        captcha: "human",
      }),
    ).toEqual({ ok: true });
    expect(responses()).toHaveLength(1);
    expect(fake.docs.get(responses()[0]!)).toMatchObject({
      formId: id,
      version: 1,
      answers: { [name!]: "Ari", [rating!]: "Good" },
    });
    expect(await store.getVersion(id, 1)).toMatchObject({ answered: true });
    expect(await store.get(id)).toMatchObject({ responseCount: 1, version: 2 });
    // The next edit of the questions is version 2; the first response keeps version 1.
    const edited = await actions().save(...as(owner))({
      ...formInput({ questions: [question({ id: name, label: "Name" })] }),
      id,
      version: 2,
    });
    expect(edited).toMatchObject({ ok: true, data: { currentVersion: 2, newVersion: true } });
    expect(await store.get(id)).toMatchObject({ responseCount: 1, status: "published" });
  });

  it("checks the captcha first and writes nothing when it fails", async () => {
    const { publicToken } = await published();
    expect(await submit({ token: publicToken, version: 1, answers: {}, captcha: "bot" })).toEqual({
      ok: false,
      error: "captcha",
    });
    expect(responses()).toHaveLength(0);
    expect(await submit({ token: publicToken, version: 1, answers: [], captcha: "x" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(captcha).toHaveBeenCalledTimes(1);
  });

  it("validates the answers on the server against the version", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Superb" },
        captcha: "human",
      }),
    ).toEqual({
      ok: false,
      error: "answers",
      fields: { [rating!]: "Choose one of the options." },
    });
    expect(
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: "Ari", [rating!]: "Good", q_injected: "x" },
        captcha: "human",
      }),
    ).toMatchObject({ ok: false, error: "answers", fields: { form: "Unknown question." } });
    expect(responses()).toHaveLength(0);
    // The questions changed since the page was opened: reload.
    expect(await submit({ token: publicToken, version: 9, answers: {}, captcha: "human" })).toEqual(
      { ok: false, error: "changed" },
    );
  });

  it("refuses unknown tokens, recruitment forms and answers outside the window", async () => {
    const { id, publicToken } = await published({
      opensAt: "2026-10-21T00:00:00.000Z",
      closesAt: "2026-10-22T00:00:00.000Z",
    });
    const [name, rating] = await questionIds(id);
    const answer = {
      token: publicToken,
      version: 1,
      answers: { [name!]: "Ari", [rating!]: "Good" },
      captcha: "human",
    };
    expect(await submit({ ...answer, token: "tokenUnknown0000000000000" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await submit(answer)).toEqual({ ok: false, error: "closed" });
    expect(await reader()(publicToken)).toMatchObject({ state: "upcoming" });
    clock = new Date("2026-10-21T10:00:00Z");
    expect(await submit(answer)).toEqual({ ok: true });
    clock = new Date("2026-10-22T00:00:00Z");
    expect(await submit(answer)).toEqual({ ok: false, error: "closed" });
    clock = new Date("2026-10-21T10:00:00Z");
    fake.docs.set(`forms/${id}`, { ...fake.docs.get(`forms/${id}`), usage: "recruitment" });
    expect(await submit(answer)).toEqual({ ok: false, error: "not_found" });
    expect(responses()).toHaveLength(1);
  });
});

describe("missing or malformed data", () => {
  it("treats a missing version, a malformed token and a missing count safely", async () => {
    const { id, publicToken } = await published();
    expect(await submit({ token: "../x", version: 1, answers: {}, captcha: "human" })).toEqual({
      ok: false,
      error: "not_found",
    });
    const form = { ...fake.docs.get(`forms/${id}`) };
    delete form["responseCount"];
    fake.docs.set(`forms/${id}`, form);
    expect(await store.get(id)).toMatchObject({ responseCount: 0 });
    fake.docs.delete(`formVersions/${id}_1`);
    expect(await reader()(publicToken)).toBeNull();
    expect(await submit({ token: publicToken, version: 1, answers: {}, captcha: "human" })).toEqual(
      { ok: false, error: "not_found" },
    );
    // Without its questions a form cannot be published again.
    await actions().close(...as(owner))({ id, version: 2 });
    expect(await actions().publish(...as(owner))({ id, version: 3 })).toMatchObject({
      error: "refused",
      issues: ["Add at least one question."],
    });
  });
});

describe("responses and export (forms.responses, forms.export)", () => {
  it("lists responses newest first; the CSV export needs forms.export and is a security event", async () => {
    const { id, publicToken } = await published();
    const [name, rating] = await questionIds(id);
    for (const [i, who] of ["Ari", "=HYPERLINK(1)"].entries()) {
      clock = new Date(`2026-10-20T0${6 + i}:00:00Z`);
      await submit({
        token: publicToken,
        version: 1,
        answers: { [name!]: who, [rating!]: "Bad" },
        captcha: "human",
      });
    }
    expect((await store.listResponses(id, 10)).map((r) => r.answers[name!])).toEqual([
      "=HYPERLINK(1)",
      "Ari",
    ]);
    expect(await actions().exportResponses(...as(staff(["forms.responses"])))({ id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(securityEvents).toHaveLength(0);
    const exported = await actions().exportResponses(...as(owner))({ id });
    expect(exported).toMatchObject({
      ok: true,
      data: {
        title: "Feedback Kongres 2026",
        header: ["Submitted at (UTC)", "Version", "Full name", "Rating"],
        rows: [
          ["2026-10-20T07:00:00.000Z", "1", "=HYPERLINK(1)", "Bad"],
          ["2026-10-20T06:00:00.000Z", "1", "Ari", "Bad"],
        ],
      },
    });
    expect(securityEvents).toEqual([{ actorId: "staff-1", details: { formId: id, responses: 2 } }]);
    expect(await actions().exportResponses(...as(owner))({ id: "missing" })).toMatchObject({
      ok: false,
      error: "refused",
    });
  });
});
