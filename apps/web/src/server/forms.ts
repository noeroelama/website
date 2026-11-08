import "server-only";
import { z } from "zod";
import type { SubmitOutcome } from "@website/db/sql";
import {
  toPublicForm,
  type Form,
  type FormVersion,
  type PublicAnswerState,
  type PublicForm,
} from "@website/domain/forms";

export type FormView = { readonly form: PublicForm; readonly state: PublicAnswerState };

export function createPublicFormReader(deps: {
  readonly find: (
    token: string,
  ) => Promise<{ form: Form; version: FormVersion; state: PublicAnswerState } | null>;
}) {
  return async (token: string): Promise<FormView | null> => {
    const found = await deps.find(token);
    return found && { form: toPublicForm(found.form, found.version), state: found.state };
  };
}

export interface FormSubmissionDeps {
  readonly submit: (
    token: string,
    version: number,
    answers: unknown,
    now: Date,
  ) => Promise<SubmitOutcome>;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly now: () => Date;
}

export type FormSubmitResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: "invalid" | "captcha" | "not_found" | "closed" | "changed";
    }
  | {
      readonly ok: false;
      readonly error: "answers";
      readonly fields: Readonly<Record<string, string>>;
    };

const Input = z
  .object({
    token: z.string().max(64),
    version: z.number().int().min(1),
    answers: z.record(z.string().max(40), z.unknown()),
    captcha: z.string().max(4000),
  })
  .strict();

export function createFormSubmission(deps: FormSubmissionDeps) {
  return async (input: unknown): Promise<FormSubmitResult> => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!(await deps.captcha(parsed.data.captcha))) return { ok: false, error: "captcha" };
    const { token, version, answers } = parsed.data;
    return deps.submit(token, version, answers, deps.now());
  };
}
