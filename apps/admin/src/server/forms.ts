import "server-only";
import { z } from "zod";
import type { SqlFormStore } from "@website/db/sql";
import {
  assertPublishable,
  FormInputSchema,
  responseTable,
  withQuestionIds,
  type Form,
} from "@website/domain/forms";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface FormDeps {
  readonly forms: Pick<
    SqlFormStore,
    "save" | "write" | "get" | "versionIn" | "listVersions" | "listResponses"
  >;
  readonly now: () => Date;
  readonly uuid: () => string;
  readonly token: () => string;
  readonly logExport: (actorId: string, details: Record<string, unknown>) => void;
}

export const EXPORT_LIMIT = 10_000;

const SaveInput = FormInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "DELETE" | "PUBLISH" | "UNPUBLISH";

const formAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Form | null,
    next: Form,
  ) =>
    audit({
      module: "forms",
      action,
      resourceType: "form",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: action === "CREATE" || action === "DELETE",
    });

export function createFormActions(deps: FormDeps) {
  const save = createGuardedAction({
    permission: "forms.edit",
    input: SaveInput,
    handler: async ({ id, version, questions, ...settings }, _principal, audit) => {
      const { form, plan } = await deps.forms.save(
        id ?? null,
        version,
        settings,
        withQuestionIds(questions, deps.uuid),
        (current, next) => {
          if (current?.status === "published") assertPublishable(current, next);
        },
        (before, after, current, next) =>
          formAudit(audit, current ? "UPDATE" : "CREATE")(before, after, current, next),
        deps.now(),
      );
      return {
        id: form.id,
        version: form.version,
        currentVersion: form.currentVersion,
        newVersion: plan.write === "create" && plan.number > 1,
      };
    },
  });

  const remove = createGuardedAction({
    permission: "forms.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.forms.write(
        id,
        version,
        (current) => ({ ...(current as Form), deletedAt: now }),
        formAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  const publish = createGuardedAction({
    permission: "forms.publish",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const saved = await deps.forms.write(
        id,
        version,
        async (current, tx) => {
          const form = current as Form;
          const questions = await deps.forms.versionIn(tx, form.id, form.currentVersion);
          assertPublishable(form, questions?.questions ?? []);
          return { ...form, status: "published", publicToken: form.publicToken ?? deps.token() };
        },
        formAudit(audit, "PUBLISH"),
        deps.now(),
      );
      return { version: saved.version, publicToken: saved.publicToken as string };
    },
  });

  const close = createGuardedAction({
    permission: "forms.publish",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const saved = await deps.forms.write(
        id,
        version,
        (current) => {
          const form = current as Form;
          if (form.status !== "published") {
            throw new RuleViolationError("Only a published form can be closed.");
          }
          return { ...form, status: "closed" };
        },
        formAudit(audit, "UNPUBLISH"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const exportResponses = createGuardedAction({
    permission: "forms.export",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal) => {
      const form = await deps.forms.get(id);
      if (!form || form.deletedAt) throw new RuleViolationError("This form does not exist.");
      const [versions, responses] = await Promise.all([
        deps.forms.listVersions(id),
        deps.forms.listResponses(id, EXPORT_LIMIT),
      ]);
      deps.logExport(principal.userId, { formId: id, responses: responses.length });
      return { title: form.title, ...responseTable(versions, responses) };
    },
  });

  return { save, remove, publish, close, exportResponses };
}
