import { z } from "zod";
import { safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "number",
  "date",
  "single_choice",
  "multi_choice",
  "file",
  "consent",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const FORM_USAGES = ["public", "recruitment"] as const;
export type FormUsage = (typeof FORM_USAGES)[number];

export const FORM_STATUSES = ["draft", "published", "closed"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const MAX_QUESTIONS = 100;
export const MAX_OPTIONS = 50;
export const TEXT_LIMITS = { short_text: 300, long_text: 5000, other: 200 } as const;

export interface Question {
  readonly id: string;
  readonly type: QuestionType;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly options: readonly string[];
  readonly allowOther: boolean;
  readonly maxSelections: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export interface Form extends EntityMeta {
  readonly title: string;
  readonly description: string;
  readonly usage: FormUsage;
  readonly status: FormStatus;
  readonly publicToken: string | null;
  readonly currentVersion: number;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
  readonly responseCount: number;
}

export interface FormVersion {
  readonly formId: string;
  readonly number: number;
  readonly questions: readonly Question[];
  readonly answered: boolean;
  readonly createdAt: Date;
}

export interface FileAnswer {
  readonly path: string;
  readonly name: string;
  readonly contentType: "application/pdf" | "image/webp";
  readonly size: number;
}
export type AnswerValue = string | number | boolean | readonly string[] | FileAnswer;
export type Answers = Readonly<Record<string, AnswerValue>>;

export interface FormResponse {
  readonly id: string;
  readonly formId: string;
  readonly version: number;
  readonly answers: Answers;
  readonly submittedAt: Date;
}

export const versionDocId = (formId: string, n: number) => `${formId}_${n}`;

const QUESTION_ID = /^q_[A-Za-z0-9]{1,32}$/;
const isChoice = (type: QuestionType) => type === "single_choice" || type === "multi_choice";

export const newQuestionId = (uuid: string) => `q_${uuid.replace(/-/g, "").slice(0, 8)}`;

export const QuestionInputSchema = z
  .object({
    id: z.string().refine((v) => v === "" || QUESTION_ID.test(v), "Invalid question id."),
    type: z.enum(QUESTION_TYPES, { error: "Choose a question type." }),
    label: safeText(300),
    description: safeText(1000, { multiline: true, allowEmpty: true }),
    required: z.boolean(),
    options: z.array(safeText(200)).max(MAX_OPTIONS, `At most ${MAX_OPTIONS} options.`),
    allowOther: z.boolean(),
    maxSelections: z.number().int().min(1).nullable(),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (isChoice(q.type)) {
      if (q.options.length < 2) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least 2 options." });
      }
      if (new Set(q.options.map((o) => o.toLowerCase())).size !== q.options.length) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Options must be unique." });
      }
    }
    if (q.type === "multi_choice" && q.maxSelections !== null) {
      if (q.maxSelections > q.options.length + (q.allowOther ? 1 : 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSelections"],
          message: "The limit is larger than the number of options.",
        });
      }
    }
    if (q.type === "number" && q.min !== null && q.max !== null && q.min > q.max) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "Max must be at least min." });
    }
  })
  .transform((q): Omit<Question, "id"> & { id: string } => ({
    id: q.id,
    type: q.type,
    label: q.label,
    description: q.description,
    required: q.required,
    options: isChoice(q.type) ? q.options : [],
    allowOther: isChoice(q.type) ? q.allowOther : false,
    maxSelections: q.type === "multi_choice" ? q.maxSelections : null,
    min: q.type === "number" ? q.min : null,
    max: q.type === "number" ? q.max : null,
  }));
export type QuestionInput = z.output<typeof QuestionInputSchema>;

const optionalDate = z.coerce.date().nullable();

export const FormInputSchema = z
  .object({
    title: safeText(120).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    description: safeText(2000, { multiline: true, allowEmpty: true }),
    usage: z.enum(FORM_USAGES, { error: "Choose where the form is used." }),
    opensAt: optionalDate,
    closesAt: optionalDate,
    questions: z
      .array(QuestionInputSchema)
      .min(1, "Add at least one question.")
      .max(MAX_QUESTIONS, `At most ${MAX_QUESTIONS} questions.`),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.opensAt && f.closesAt && f.closesAt <= f.opensAt) {
      ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Close after the opening." });
    }
    const ids = f.questions.map((q) => q.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["questions"], message: "Duplicate question id." });
    }
  });
export type FormInput = z.output<typeof FormInputSchema>;

export function withQuestionIds(
  questions: readonly QuestionInput[],
  uuid: () => string,
): Question[] {
  return questions.map((q) => ({ ...q, id: q.id || newQuestionId(uuid()) }));
}

export function sameQuestions(a: readonly Question[], b: readonly Question[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type VersionPlan =
  | { readonly write: "none"; readonly number: number }
  | { readonly write: "overwrite"; readonly number: number }
  | { readonly write: "create"; readonly number: number };

export function planVersion(current: FormVersion | null, questions: readonly Question[]) {
  if (current === null) return { write: "create", number: 1 } as const satisfies VersionPlan;
  if (sameQuestions(current.questions, questions)) {
    return { write: "none", number: current.number } as const satisfies VersionPlan;
  }
  return current.answered
    ? ({ write: "create", number: current.number + 1 } as const satisfies VersionPlan)
    : ({ write: "overwrite", number: current.number } as const satisfies VersionPlan);
}

export function assertPublishable(form: Pick<Form, "usage">, questions: readonly Question[]) {
  if (form.usage !== "public") {
    throw new RuleViolationError("Recruitment forms are answered in the application, not here.");
  }
  if (questions.length === 0) throw new RuleViolationError("Add at least one question.");
  if (questions.some((q) => q.type === "file")) {
    throw new RuleViolationError("Public forms cannot ask for files.");
  }
}

export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
export const isPublicToken = (value: string) => PUBLIC_TOKEN_PATTERN.test(value);

export type FormWindow = "upcoming" | "open" | "closed";

export function formWindow(
  form: Pick<Form, "status" | "opensAt" | "closesAt">,
  now: Date,
): FormWindow {
  if (form.status !== "published") return "closed";
  if (form.closesAt && form.closesAt <= now) return "closed";
  if (form.opensAt && form.opensAt > now) return "upcoming";
  return "open";
}

export type PublicAnswerState = FormWindow | "not_found";

export function publicAnswerState(
  form: Pick<Form, "usage" | "status" | "publicToken" | "deletedAt" | "opensAt" | "closesAt">,
  now: Date,
): PublicAnswerState {
  if (form.usage !== "public" || form.deletedAt !== null || form.publicToken === null) {
    return "not_found";
  }
  if (form.status === "draft") return "not_found";
  return formWindow(form, now);
}

export interface PublicForm {
  readonly title: string;
  readonly description: string;
  readonly version: number;
  readonly questions: readonly Question[];
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
}

export function toPublicForm(form: Form, version: FormVersion): PublicForm {
  return {
    title: form.title,
    description: form.description,
    version: version.number,
    questions: version.questions,
    opensAt: form.opensAt,
    closesAt: form.closesAt,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const FileAnswerSchema = z
  .object({
    path: z.string().regex(/^forms\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_.-]{1,200}$/),
    name: safeText(200),
    contentType: z.enum(["application/pdf", "image/webp"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

const chosen = (q: Question) => (value: string) =>
  q.options.includes(value) ? true : q.allowOther && value.length > 0;

function answerSchema(q: Question): z.ZodType<AnswerValue> {
  switch (q.type) {
    case "short_text":
      return safeText(TEXT_LIMITS.short_text);
    case "long_text":
      return safeText(TEXT_LIMITS.long_text, { multiline: true });
    case "email":
      return z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid e-mail."));
    case "number": {
      let schema = z.number({ error: "Enter a number." }).finite();
      if (q.min !== null) schema = schema.min(q.min, `At least ${q.min}.`);
      if (q.max !== null) schema = schema.max(q.max, `At most ${q.max}.`);
      return schema;
    }
    case "date":
      return z.string().regex(DATE, "Enter a date.").refine(isRealDate, "Enter a real date.");
    case "single_choice":
      return safeText(TEXT_LIMITS.other).refine(chosen(q), "Choose one of the options.");
    case "multi_choice":
      return z
        .array(safeText(TEXT_LIMITS.other))
        .min(1)
        .max(q.maxSelections ?? MAX_OPTIONS + 1, `Choose at most ${q.maxSelections}.`)
        .refine((values) => new Set(values).size === values.length, "Each option once.")
        .refine((values) => values.every(chosen(q)), "Choose from the options.")
        .refine(
          (values) => values.filter((v) => !q.options.includes(v)).length <= 1,
          "Only one other answer.",
        );
    case "file":
      return FileAnswerSchema;
    case "consent":
      return z.literal(true, { error: "Tick to agree." });
  }
}

const isBlank = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === false ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

export function answersSchema(questions: readonly Question[]) {
  const shape = Object.fromEntries(
    questions.map((q) => {
      const schema = answerSchema(q);
      return [q.id, q.required ? schema : schema.optional()];
    }),
  );
  return z.preprocess(
    (raw) =>
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).filter(([key, value]) => {
              const question = questions.find((q) => q.id === key);
              return question === undefined || !(isBlank(value) && !question.required);
            }),
          )
        : raw,
    z.object(shape).strict(),
  );
}

export type AnswersResult =
  | { readonly ok: true; readonly answers: Answers }
  | { readonly ok: false; readonly fields: Readonly<Record<string, string>> };

const REQUIRED_MESSAGE = "This question is required.";

export function parseAnswers(questions: readonly Question[], raw: unknown): AnswersResult {
  const parsed = answersSchema(questions).safeParse(raw);
  if (parsed.success) return { ok: true, answers: parsed.data as Answers };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (issue.code === "unrecognized_keys" && key === "form") {
      fields["form"] ??= "Unknown question.";
      continue;
    }
    const question = questions.find((q) => q.id === key);
    const missing = question && issue.code === "invalid_type" && issue.input === undefined;
    fields[key] ??= missing ? REQUIRED_MESSAGE : issue.message;
  }
  return { ok: false, fields };
}

export function answerText(value: AnswerValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return (value as FileAnswer).name;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function responseTable(
  versions: readonly FormVersion[],
  responses: readonly FormResponse[],
): { header: string[]; rows: string[][] } {
  const columns = new Map<string, string>();
  for (const v of [...versions].sort((a, b) => b.number - a.number)) {
    for (const q of v.questions) if (!columns.has(q.id)) columns.set(q.id, q.label);
  }
  const ids = [...columns.keys()];
  return {
    header: ["Submitted at (UTC)", "Version", ...columns.values()],
    rows: responses.map((r) => [
      r.submittedAt.toISOString(),
      String(r.version),
      ...ids.map((id) => answerText(r.answers[id])),
    ]),
  };
}
