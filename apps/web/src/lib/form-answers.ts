import type { AnswerValue, Question } from "@website/domain/forms";

/** What the form renderer (components/form-fields.tsx) collects, per question id. */
export interface FieldValues {
  readonly values: Readonly<Record<string, string | readonly string[] | boolean>>;
  /** "Other" text per choice question (sent when "Other" is picked). */
  readonly others: Readonly<Record<string, string>>;
}

export const EMPTY_VALUES: FieldValues = { values: {}, others: {} };

/** The value "Other" stands for in a radio / checkbox group. */
export const OTHER = "\u0000other";

/** The answers as the server expects them (blank answers are dropped there). */
export function answersFrom(
  questions: readonly Question[],
  { values, others }: FieldValues,
): Record<string, AnswerValue> {
  const answers: Record<string, AnswerValue> = {};
  for (const q of questions) {
    const value = values[q.id];
    if (value === undefined) continue;
    const other = (others[q.id] ?? "").trim();
    if (q.type === "number") {
      if (typeof value === "string" && value.trim() !== "") answers[q.id] = Number(value);
    } else if (q.type === "single_choice") {
      answers[q.id] = value === OTHER ? other : value;
    } else if (q.type === "multi_choice" && typeof value === "object") {
      answers[q.id] = value.map((v) => (v === OTHER ? other : v));
    } else {
      answers[q.id] = value;
    }
  }
  return answers;
}
