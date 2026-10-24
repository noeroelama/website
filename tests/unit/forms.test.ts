import { describe, expect, it } from "vitest";
import {
  answersSchema,
  answerText,
  assertPublishable,
  isPublicToken,
  publicAnswerState,
  toPublicForm,
  FormInputSchema,
  formWindow,
  newQuestionId,
  parseAnswers,
  planVersion,
  QuestionInputSchema,
  responseTable,
  sameQuestions,
  versionDocId,
  withQuestionIds,
  type FormVersion,
  type Question,
  type QuestionType,
} from "@website/domain/forms";

const question = (id: string, type: QuestionType, extra: Partial<Question> = {}): Question => ({
  id,
  type,
  label: `Question ${id}`,
  description: "",
  required: true,
  options: type === "single_choice" || type === "multi_choice" ? ["Red", "Blue", "Green"] : [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});
const version = (n: number, questions: Question[], answered = false): FormVersion => ({
  formId: "f1",
  number: n,
  questions,
  answered,
  createdAt: new Date("2026-10-01T00:00:00Z"),
});
const input = (extra: Record<string, unknown> = {}) => ({
  id: "",
  type: "short_text",
  label: "Your name",
  description: "",
  required: true,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});

describe("question builder input (C1)", () => {
  it("clears the fields that do not belong to the type", () => {
    expect(
      QuestionInputSchema.parse(
        input({ options: ["a", "b"], allowOther: true, maxSelections: 2, min: 1, max: 3 }),
      ),
    ).toMatchObject({ options: [], allowOther: false, maxSelections: null, min: null, max: null });
    expect(
      QuestionInputSchema.parse(input({ type: "number", options: ["a"], min: 1, max: 3 })),
    ).toMatchObject({ options: [], min: 1, max: 3 });
    expect(
      QuestionInputSchema.parse(
        input({ type: "multi_choice", options: ["a", "b"], maxSelections: 2, min: 1 }),
      ),
    ).toMatchObject({ options: ["a", "b"], maxSelections: 2, min: null });
    expect(
      QuestionInputSchema.parse(
        input({ type: "single_choice", options: ["a", "b"], maxSelections: 1 }),
      ),
    ).toMatchObject({ maxSelections: null });
  });

  it("refuses broken questions", () => {
    const bad = [
      input({ id: "x/y" }),
      input({ type: "essay" }),
      input({ label: "" }),
      input({ label: "<b>hi</b>" }),
      input({ type: "single_choice", options: ["only"] }),
      input({ type: "multi_choice", options: ["a", "A"] }),
      input({ type: "multi_choice", options: ["a", "b"], maxSelections: 3 }),
      input({ type: "number", min: 5, max: 1 }),
      input({ extra: true }),
      input({ type: "single_choice", options: Array.from({ length: 51 }, (_, i) => `o${i}`) }),
    ];
    for (const value of bad) {
      expect(QuestionInputSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
    // "Other" counts towards the multi-choice limit.
    expect(
      QuestionInputSchema.safeParse(
        input({ type: "multi_choice", options: ["a", "b"], allowOther: true, maxSelections: 3 }),
      ).success,
    ).toBe(true);
  });

  it("validates the form: title, window order, at least one question, unique ids", () => {
    const form = {
      title: "Survey",
      description: "",
      usage: "public",
      opensAt: null,
      closesAt: null,
      questions: [input()],
    };
    expect(FormInputSchema.safeParse(form).success).toBe(true);
    const bad = [
      { ...form, title: "ab" },
      { ...form, usage: "secret" },
      { ...form, questions: [] },
      { ...form, opensAt: "2026-10-02T00:00:00Z", closesAt: "2026-10-01T00:00:00Z" },
      { ...form, questions: [input({ id: "q_a" }), input({ id: "q_a" })] },
      { ...form, questions: Array.from({ length: 101 }, () => input()) },
      { ...form, extra: 1 },
    ];
    for (const value of bad) {
      expect(FormInputSchema.safeParse(value).success, JSON.stringify(value).slice(0, 80)).toBe(
        false,
      );
    }
    // Two new questions both have an empty id: not a duplicate.
    expect(FormInputSchema.safeParse({ ...form, questions: [input(), input()] }).success).toBe(
      true,
    );
  });

  it("gives new questions an id and keeps existing ids", () => {
    let n = 0;
    const uuid = () => `0000000${++n}-aaaa-bbbb-cccc-dddddddddddd`;
    const parsed = FormInputSchema.parse({
      title: "Survey",
      description: "",
      usage: "public",
      opensAt: null,
      closesAt: null,
      questions: [input({ id: "q_keep" }), input()],
    });
    expect(withQuestionIds(parsed.questions, uuid).map((q) => q.id)).toEqual([
      "q_keep",
      "q_00000001",
    ]);
    expect(newQuestionId("abcdef12-3456")).toBe("q_abcdef12");
    expect(versionDocId("f1", 3)).toBe("f1_3");
  });
});

describe("version freezing (C1)", () => {
  const q1 = question("q_1", "short_text");
  const q2 = question("q_2", "email");

  it("creates version 1 for a new form", () => {
    expect(planVersion(null, [q1])).toEqual({ write: "create", number: 1 });
  });

  it("writes nothing when the questions did not change", () => {
    expect(planVersion(version(2, [q1], true), [{ ...q1 }])).toEqual({ write: "none", number: 2 });
  });

  it("edits an unanswered version in place", () => {
    expect(planVersion(version(1, [q1]), [q1, q2])).toEqual({ write: "overwrite", number: 1 });
  });

  it("never changes an answered version: the edit becomes version n+1", () => {
    expect(planVersion(version(1, [q1], true), [q1, q2])).toEqual({ write: "create", number: 2 });
    expect(planVersion(version(1, [q1], true), [{ ...q1, label: "Name" }])).toEqual({
      write: "create",
      number: 2,
    });
    // Order matters (the renderer shows questions in order).
    expect(sameQuestions([q1, q2], [q2, q1])).toBe(false);
  });
});

describe("publishing and the answer window (C2)", () => {
  it("publishes public forms without file questions only", () => {
    expect(() => assertPublishable({ usage: "public" }, [question("q_1", "email")])).not.toThrow();
    expect(() => assertPublishable({ usage: "recruitment" }, [question("q_1", "email")])).toThrow(
      /application/,
    );
    expect(() => assertPublishable({ usage: "public" }, [])).toThrow(/question/);
    expect(() => assertPublishable({ usage: "public" }, [question("q_1", "file")])).toThrow(
      /files/,
    );
  });

  it("is upcoming before opensAt, open inside the window, closed after closesAt or when not published", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const published = { status: "published", opensAt: null, closesAt: null } as const;
    expect(formWindow(published, now)).toBe("open");
    expect(formWindow({ ...published, opensAt: new Date("2026-10-11T00:00:00Z") }, now)).toBe(
      "upcoming",
    );
    expect(formWindow({ ...published, closesAt: now }, now)).toBe("closed");
    expect(
      formWindow(
        {
          ...published,
          opensAt: new Date("2026-10-01T00:00:00Z"),
          closesAt: new Date("2026-10-20T00:00:00Z"),
        },
        now,
      ),
    ).toBe("open");
    expect(formWindow({ ...published, status: "draft" }, now)).toBe("closed");
    expect(formWindow({ ...published, status: "closed" }, now)).toBe("closed");
  });
});

describe("the public path guard (C2: recruitment never accepted at /f/{token})", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const form = {
    usage: "public",
    status: "published",
    publicToken: "AAAAAAAAAAAAAAAAAAAAAA",
    deletedAt: null,
    opensAt: null,
    closesAt: null,
  } as const;

  it("answers only published (or closed) public forms with a token", () => {
    expect(publicAnswerState(form, now)).toBe("open");
    expect(publicAnswerState({ ...form, usage: "recruitment" }, now)).toBe("not_found");
    expect(publicAnswerState({ ...form, deletedAt: now }, now)).toBe("not_found");
    expect(publicAnswerState({ ...form, publicToken: null }, now)).toBe("not_found");
    expect(publicAnswerState({ ...form, status: "draft" }, now)).toBe("not_found");
    expect(publicAnswerState({ ...form, status: "closed" }, now)).toBe("closed");
    expect(publicAnswerState({ ...form, opensAt: new Date("2026-10-11T00:00:00Z") }, now)).toBe(
      "upcoming",
    );
  });

  it("recognises tokens (128 bits, base64url) and builds the public view without ids", () => {
    expect(isPublicToken("AAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isPublicToken("short")).toBe(false);
    expect(isPublicToken("../../forms/abcdefghijklmnop")).toBe(false);
    const q = question("q_1", "email");
    const view = toPublicForm(
      {
        ...form,
        id: "f1",
        title: "Survey",
        description: "Hi",
        currentVersion: 3,
        responseCount: 9,
        version: 5,
        createdAt: now,
        updatedAt: now,
      },
      version(3, [q]),
    );
    expect(view).toEqual({
      title: "Survey",
      description: "Hi",
      version: 3,
      questions: [q],
      opensAt: null,
      closesAt: null,
    });
  });
});

describe("answers schema built from a version (C1)", () => {
  const all: Question[] = [
    question("q_short", "short_text"),
    question("q_long", "long_text"),
    question("q_mail", "email"),
    question("q_num", "number", { min: 1, max: 10 }),
    question("q_date", "date"),
    question("q_one", "single_choice", { allowOther: true }),
    question("q_many", "multi_choice", { maxSelections: 2 }),
    question("q_file", "file"),
    question("q_ok", "consent"),
  ];
  const file = {
    path: "forms/f1/cv_1.pdf",
    name: "cv.pdf",
    contentType: "application/pdf",
    size: 1024,
  };
  const valid = {
    q_short: "  Ari  ",
    q_long: "Line one\nLine two",
    q_mail: " Ari@Example.ORG ",
    q_num: 7,
    q_date: "2026-02-28",
    q_one: "Blue",
    q_many: ["Red", "Green"],
    q_file: file,
    q_ok: true,
  };

  it("accepts every type and normalises text and e-mail", () => {
    expect(parseAnswers(all, valid)).toEqual({
      ok: true,
      answers: { ...valid, q_short: "Ari", q_mail: "ari@example.org" },
    });
    // "Other" free text when allowed.
    expect(parseAnswers(all, { ...valid, q_one: "Purple" })).toMatchObject({ ok: true });
    // A number without limits takes any finite number.
    expect(parseAnswers([question("q_n", "number")], { q_n: -1e9 })).toMatchObject({ ok: true });
  });

  it("refuses unknown keys (strict)", () => {
    expect(parseAnswers(all, { ...valid, q_extra: "x" })).toEqual({
      ok: false,
      fields: { form: "Unknown question." },
    });
    expect(answersSchema(all).safeParse([]).success).toBe(false);
    expect(answersSchema(all).safeParse(null).success).toBe(false);
  });

  it("requires required questions and names them", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest["q_mail"];
    expect(parseAnswers(all, rest)).toEqual({
      ok: false,
      fields: { q_mail: "This question is required." },
    });
    // Blank answers to required questions are refused too.
    const blank = parseAnswers(all, { ...valid, q_short: "  " });
    expect(blank.ok === false && Object.keys(blank.fields)).toEqual(["q_short"]);
    expect(parseAnswers(all, { ...valid, q_ok: false })).toMatchObject({
      ok: false,
      fields: { q_ok: "Tick to agree." },
    });
  });

  it("drops blank answers to optional questions", () => {
    const optional = all.map((q) => ({ ...q, required: false }));
    expect(
      parseAnswers(optional, {
        q_short: "",
        q_many: [],
        q_ok: false,
        q_num: null,
        q_mail: "a@b.co",
      }),
    ).toEqual({ ok: true, answers: { q_mail: "a@b.co" } });
    expect(parseAnswers(optional, {})).toEqual({ ok: true, answers: {} });
  });

  it("refuses wrong values per type", () => {
    const wrong: Record<string, unknown>[] = [
      { q_short: "x".repeat(301) },
      { q_short: "<script>" },
      { q_long: "x".repeat(5001) },
      { q_mail: "not-an-email" },
      { q_num: "7" },
      { q_num: 0 },
      { q_num: 11 },
      { q_num: Number.POSITIVE_INFINITY },
      { q_date: "2026-02-30" },
      { q_date: "28/02/2026" },
      { q_many: ["Red", "Blue", "Green"] },
      { q_many: ["Red", "Red"] },
      { q_many: ["Red", "Pink"] },
      { q_file: { ...file, path: "members/ktm/x.webp" } },
      { q_file: { ...file, contentType: "text/html" } },
      { q_file: { ...file, size: 0 } },
      { q_file: { ...file, extra: 1 } },
    ];
    for (const patch of wrong) {
      const result = parseAnswers(all, { ...valid, ...patch });
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(Object.keys(result.fields)).toEqual(Object.keys(patch));
    }
  });

  it("allows one 'other' answer only where the question allows it", () => {
    const closed = [question("q_one", "single_choice")];
    expect(parseAnswers(closed, { q_one: "Purple" })).toEqual({
      ok: false,
      fields: { q_one: "Choose one of the options." },
    });
    const many = [question("q_many", "multi_choice", { allowOther: true })];
    expect(parseAnswers(many, { q_many: ["Red", "Pink"] })).toMatchObject({ ok: true });
    expect(parseAnswers(many, { q_many: ["Pink", "Black"] })).toMatchObject({ ok: false });
    // No limit set: every option may be ticked.
    expect(parseAnswers(many, { q_many: ["Red", "Blue", "Green"] })).toMatchObject({ ok: true });
  });
});

describe("responses table (C2 export)", () => {
  it("keeps answers in their question's column across versions, newest labels first", () => {
    const v1 = version(1, [question("q_a", "short_text", { label: "Name" })], true);
    const v2 = version(2, [
      question("q_a", "short_text", { label: "Full name" }),
      question("q_b", "multi_choice", { label: "Colours" }),
    ]);
    const table = responseTable(
      [v1, v2],
      [
        {
          id: "r1",
          formId: "f1",
          version: 1,
          answers: { q_a: "Ari" },
          submittedAt: new Date("2026-10-01T01:00:00Z"),
        },
        {
          id: "r2",
          formId: "f1",
          version: 2,
          answers: { q_a: "Budi", q_b: ["Red", "Blue"] },
          submittedAt: new Date("2026-10-02T01:00:00Z"),
        },
      ],
    );
    expect(table).toEqual({
      header: ["Submitted at (UTC)", "Version", "Full name", "Colours"],
      rows: [
        ["2026-10-01T01:00:00.000Z", "1", "Ari", ""],
        ["2026-10-02T01:00:00.000Z", "2", "Budi", "Red; Blue"],
      ],
    });
  });

  it("writes every answer type as text", () => {
    expect(answerText(undefined)).toBe("");
    expect(answerText(true)).toBe("Yes");
    expect(answerText(false)).toBe("No");
    expect(answerText(3.5)).toBe("3.5");
    expect(
      answerText({ path: "forms/f/x.pdf", name: "x.pdf", contentType: "application/pdf", size: 1 }),
    ).toBe("x.pdf");
  });
});
