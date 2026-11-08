import "server-only";
import { z } from "zod";
import type { ApplyOutcome, SqlRecruitmentWebStore } from "@website/db/sql";
import type { ApplicationStatus } from "@website/domain/recruitment";
import {
  formFilePath,
  MAX_PORTFOLIO_BYTES,
  pactPath,
  portfolioPath,
  type Recruitment,
} from "@website/domain/recruitment";
import { isPdf, type ImageStorage } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";
import { safeId, safeText } from "@website/security/validation";

export interface ApplyingDeps {
  readonly store: Pick<
    SqlRecruitmentWebStore,
    | "getVisible"
    | "saveDraft"
    | "setPortfolio"
    | "setAnswerFile"
    | "submit"
    | "withdraw"
    | "respondOffer"
    | "bookInterview"
    | "setPact"
  >;
  readonly profileComplete: (uid: string) => Promise<boolean>;
  readonly storage: ImageStorage;
  readonly now: () => Date;
  readonly uuid: () => string;
}

export type ApplyResult =
  | { readonly ok: true; readonly status: ApplicationStatus; readonly version: number }
  | {
      readonly ok: false;
      readonly error: "signin" | "profile" | "invalid" | "closed" | "locked" | "refused";
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly error: "answers";
      readonly fields: Readonly<Record<string, string>>;
    };

type Applicant = { readonly uid: string } | null;

const Ref = z.object({ recruitmentId: safeId }).strict();
const Draft = Ref.extend({
  choices: z.array(safeId).max(10),
  answers: z.record(z.string().max(40), z.unknown()),
}).strict();

const decodeName = (header: string | null) => {
  try {
    return decodeURIComponent(header ?? "");
  } catch {
    return "";
  }
};

const toResult = (outcome: ApplyOutcome): ApplyResult =>
  outcome.ok
    ? { ok: true, status: outcome.application.status, version: outcome.application.version }
    : outcome;

export function createApplying(deps: ApplyingDeps) {
  const gate = async <S extends z.ZodType>(
    user: Applicant,
    schema: S,
    input: unknown,
  ): Promise<{ ok: true; data: z.infer<S>; uid: string } | { ok: false; result: ApplyResult }> => {
    if (!user) return { ok: false, result: { ok: false, error: "signin" } };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, result: { ok: false, error: "invalid" } };
    if (!(await deps.profileComplete(user.uid))) {
      return { ok: false, result: { ok: false, error: "profile" } };
    }
    return { ok: true, data: parsed.data, uid: user.uid };
  };

  return {
    async saveDraft(user: Applicant, input: unknown): Promise<ApplyResult> {
      const g = await gate(user, Draft, input);
      if (!g.ok) return g.result;
      const { recruitmentId, choices, answers } = g.data;
      return toResult(
        await deps.store.saveDraft(recruitmentId, g.uid, { choices, answers }, deps.now()),
      );
    },

    async submit(user: Applicant, input: unknown): Promise<ApplyResult> {
      const g = await gate(user, Ref, input);
      if (!g.ok) return g.result;
      return toResult(await deps.store.submit(g.data.recruitmentId, g.uid, deps.now()));
    },

    async respondOffer(user: Applicant, input: unknown): Promise<ApplyResult> {
      const g = await gate(user, Ref.extend({ accept: z.boolean() }).strict(), input);
      if (!g.ok) return g.result;
      const { recruitmentId, accept } = g.data;
      return toResult(await deps.store.respondOffer(recruitmentId, g.uid, accept, deps.now()));
    },

    async bookInterview(user: Applicant, input: unknown): Promise<ApplyResult> {
      const g = await gate(user, Ref.extend({ slotId: safeId }).strict(), input);
      if (!g.ok) return g.result;
      const { recruitmentId, slotId } = g.data;
      return toResult(await deps.store.bookInterview(recruitmentId, g.uid, slotId, deps.now()));
    },

    async withdraw(user: Applicant, input: unknown): Promise<ApplyResult> {
      const g = await gate(user, Ref, input);
      if (!g.ok) return g.result;
      return toResult(await deps.store.withdraw(g.data.recruitmentId, g.uid, deps.now()));
    },

    async uploadFile(
      user: Applicant,
      recruitmentId: string,
      target: string | null,
      request: Request,
    ): Promise<Response> {
      const questionId = target === "pact" ? null : target;
      if (!user) return jsonError("unauthenticated");
      const g = await gate(user, Ref, { recruitmentId });
      if (!g.ok) return Response.json(g.result, { status: 400 });
      const recruitment: Recruitment | null = await deps.store.getVisible(recruitmentId);
      if (!recruitment) return Response.json({ error: "closed" }, { status: 400 });
      if (questionId !== null && !/^q_[A-Za-z0-9]{1,32}$/.test(questionId)) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      const name = safeText(200).safeParse(decodeName(request.headers.get("x-file-name")));
      const bytes = await readBodyLimited(request, MAX_PORTFOLIO_BYTES);
      if (bytes === null) return Response.json({ error: "too_large" }, { status: 413 });
      if (!isPdf(bytes)) return Response.json({ error: "not_pdf" }, { status: 400 });
      const now = deps.now();
      const path =
        target === "pact"
          ? pactPath(recruitment.id, g.uid, now, deps.uuid())
          : questionId === null
            ? portfolioPath(recruitment.id, g.uid, now, deps.uuid())
            : formFilePath(recruitment.formId, g.uid, now, deps.uuid());
      await deps.storage.save(path, bytes, {
        visibility: "private",
        contentType: "application/pdf",
      });
      const file = {
        path,
        name: name.success ? name.data : target === null ? "portfolio.pdf" : "file.pdf",
        contentType: "application/pdf" as const,
        size: bytes.byteLength,
      };
      const outcome =
        target === "pact"
          ? await deps.store.setPact(recruitment.id, g.uid, file, now)
          : questionId === null
            ? await deps.store.setPortfolio(recruitment.id, g.uid, file, now)
            : await deps.store.setAnswerFile(recruitment.id, g.uid, questionId, file, now);
      const result = toResult(outcome);
      return Response.json(result.ok ? { ok: true, name: file.name } : result, {
        status: result.ok ? 201 : 400,
        headers: { "Cache-Control": "no-store" },
      });
    },
  };
}
