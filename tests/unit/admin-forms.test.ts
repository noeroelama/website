import { describe, expect, it } from "vitest";
import { FormInputSchema, type Form, type FormVersion } from "@website/domain/forms";
import {
  blankQuestion,
  fromDraft,
  hasOptions,
  matchesFormTab,
  toDraft,
  toFormItem,
} from "../../apps/admin/src/components/forms-model";
import { esc } from "../../apps/admin/src/components/format";

const form: Form = {
  id: "f1",
  title: "Survey",
  description: "",
  usage: "public",
  status: "published",
  publicToken: "tok",
  currentVersion: 2,
  opensAt: new Date("2026-10-01T00:00:00Z"),
  closesAt: null,
  responseCount: 3,
  version: 4,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  deletedAt: null,
};
const version: FormVersion = {
  formId: "f1",
  number: 2,
  answered: true,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  questions: [
    {
      id: "q_a",
      type: "multi_choice",
      label: "Colours",
      description: "",
      required: true,
      options: ["Red", "Blue"],
      allowOther: true,
      maxSelections: 2,
      min: null,
      max: null,
    },
  ],
};

describe("Forms page model", () => {
  it("maps a form and its current version to a row with labels", () => {
    expect(toFormItem(form, version, null)).toMatchObject({
      usageLabel: "Public form",
      statusLabel: "Published",
      opensAt: "2026-10-01T00:00:00.000Z",
      closesAt: null,
      answered: true,
      publicToken: "tok",
      responseCount: 3,
      questions: version.questions,
      modifiedAt: "2026-10-02T00:00:00.000Z",
    });
    // A form whose version could not be read shows no questions (and is not frozen).
    expect(toFormItem(form, undefined, null)).toMatchObject({ answered: false, questions: [] });
  });

  it("filters by tab", () => {
    expect(matchesFormTab({ status: "draft" }, "all")).toBe(true);
    expect(matchesFormTab({ status: "draft" }, "drafts")).toBe(true);
    expect(matchesFormTab({ status: "closed" }, "closed")).toBe(true);
    expect(matchesFormTab({ status: "closed" }, "published")).toBe(false);
  });

  it("round-trips a question through the builder row (options one per line, numbers as text)", () => {
    const [question] = version.questions;
    const draft = toDraft(question!);
    expect(draft).toMatchObject({ options: "Red\nBlue", maxSelections: "2", min: "", max: "" });
    expect(fromDraft({ ...draft, options: " Red \n\nBlue\n" })).toEqual(question);
    // The builder output is what the save action validates.
    const parsed = FormInputSchema.safeParse({
      title: "Survey",
      description: "",
      usage: "public",
      opensAt: null,
      closesAt: null,
      questions: [fromDraft({ ...blankQuestion(), label: "Name" })],
    });
    expect(parsed.success).toBe(true);
    expect(fromDraft({ ...blankQuestion(), type: "number", min: "abc" }).min).toBeNaN();
    expect(hasOptions("single_choice")).toBe(true);
    expect(hasOptions("date")).toBe(false);
  });
});

describe("CSV cells", () => {
  it("quotes, doubles inner quotes and never lets a cell run as a formula", () => {
    expect(esc('Say "hi"')).toBe('"Say ""hi"""');
    expect(esc("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    for (const start of ["+", "-", "@", "\t", "\r"]) expect(esc(`${start}1`)).toBe(`"'${start}1"`);
    expect(esc("1-2")).toBe('"1-2"');
  });
});
