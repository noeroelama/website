import { describe, expect, it } from "vitest";
import { parseAnswers, type Question, type QuestionType } from "@website/domain/forms";
import { answersFrom, EMPTY_VALUES, OTHER } from "../../apps/web/src/lib/form-answers";

const q = (id: string, type: QuestionType, extra: Partial<Question> = {}): Question => ({
  id,
  type,
  label: id,
  description: "",
  required: false,
  options: ["Red", "Blue"],
  allowOther: true,
  maxSelections: null,
  min: null,
  max: null,
  ...extra,
});

describe("public form answers (web renderer → server)", () => {
  const questions = [
    q("q_text", "short_text"),
    q("q_num", "number"),
    q("q_blank", "number"),
    q("q_one", "single_choice"),
    q("q_other", "single_choice"),
    q("q_many", "multi_choice"),
    q("q_ok", "consent"),
    q("q_skip", "date"),
  ];

  it("builds the answers the server accepts: numbers, 'Other' texts, ticks", () => {
    const answers = answersFrom(questions, {
      values: {
        q_text: "Ari",
        q_num: "7.5",
        q_blank: " ",
        q_one: "Red",
        q_other: OTHER,
        q_many: ["Blue", OTHER],
        q_ok: true,
      },
      others: { q_other: " Purple ", q_many: "Black" },
    });
    expect(answers).toEqual({
      q_text: "Ari",
      q_num: 7.5,
      q_one: "Red",
      q_other: "Purple",
      q_many: ["Blue", "Black"],
      q_ok: true,
    });
    expect(parseAnswers(questions, answers)).toMatchObject({ ok: true });
    expect(answersFrom(questions, EMPTY_VALUES)).toEqual({});
  });
});
