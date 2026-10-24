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

/** Saved answers back into renderer values (a choice outside the options is the "Other" text). */
export function valuesFrom(
  questions: readonly Question[],
  answers: Readonly<Record<string, AnswerValue>>,
): FieldValues {
  const values: Record<string, string | readonly string[] | boolean> = {};
  const others: Record<string, string> = {};
  for (const q of questions) {
    const value = answers[q.id];
    if (value === undefined) continue;
    if (q.type === "single_choice" && typeof value === "string" && !q.options.includes(value)) {
      values[q.id] = OTHER;
      others[q.id] = value;
    } else if (q.type === "multi_choice" && Array.isArray(value)) {
      const list = value as readonly string[];
      const other = list.find((v) => !q.options.includes(v));
      values[q.id] = list.map((v) => (v === other ? OTHER : v));
      if (other !== undefined) others[q.id] = other;
    } else if (typeof value === "number") {
      values[q.id] = String(value);
    } else if (typeof value === "string" || typeof value === "boolean") {
      values[q.id] = value;
    }
  }
  return { values, others };
}
