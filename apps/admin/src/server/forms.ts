import "server-only";
import { z } from "zod";
import type { FirestoreFormStore } from "@website/db/firestore";
import {
  assertPublishable,
  FormInputSchema,
  withQuestionIds,
  type Form,
} from "@website/domain/forms";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface FormDeps {
  readonly forms: Pick<FirestoreFormStore, "save" | "write">;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const SaveInput = FormInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "DELETE";

/**
 * Audit entry for one form change (module `forms`, resource `form`). A CREATE (revert = trash)
 * and a DELETE (revert = restore) are revertible; an edit is not: it may have created a new
 * question version, which a revert of the form document would leave behind.
 */
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
      revertible: action !== "UPDATE",
    });

/** Forms page actions: save (settings + questions, versioned) and delete (soft). */
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
          // A published form stays publishable (e.g. no file question for guests).
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

  return { save, remove };
}
