import "server-only";
import { z } from "zod";
import type { Decision, FirestoreApplicationStore } from "@website/db/firestore";
import type { FileAnswer } from "@website/domain/forms";
import {
  makeOffer,
  RevisionRequestSchema,
  type Application,
  type ApplicationStatus,
  type Recruitment,
} from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import type { PagePermission } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ApplicationDeps {
  readonly applications: Pick<FirestoreApplicationStore, "decide" | "get">;
  /** 15-minute signed read URL of a private Storage file. */
  readonly signedUrl: (path: string) => Promise<string>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

/** Audit entry of one decision (module `recruitment`, resource `application`; never revertible). */
const decisionAudit =
  (audit: AuditBuilder) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Application,
    next: Application,
    recruitmentTitle: string,
  ) =>
    audit({
      module: "recruitment",
      action: "UPDATE",
      resourceType: "application",
      resourceId: next.id,
      title: recruitmentTitle,
      before,
      after,
      versionBefore: current.version,
      versionAfter: next.version,
      revertible: false,
    });

/**
 * The selection queue (C3 steps 3-6). Review, offer and confirm are separate permissions:
 * `recruitment.review` asks for revisions, fails, passes to interview and rejects;
 * `recruitment.offer` offers a unit with an expiry. Seats are taken only when the applicant
 * accepts (website), in the seat counter transaction.
 */
export function createApplicationActions(deps: ApplicationDeps) {
  const decision = <S extends z.ZodType<{ id: string; version: number }>>(
    permission: PagePermission,
    input: S,
    decide: (
      input: z.infer<S>,
      userId: string,
      now: Date,
    ) => (application: Application, recruitment: Recruitment) => Decision,
  ) =>
    createGuardedAction({
      permission,
      input,
      handler: async (parsed: z.infer<S>, principal, audit) => {
        const now = deps.now();
        const next = await deps.applications.decide(
          parsed.id,
          parsed.version,
          decide(parsed, principal.userId, now),
          decisionAudit(audit),
          now,
        );
        return { status: next.status, version: next.version };
      },
    });

  const to = (status: ApplicationStatus) => () => () => ({ status });

  return {
    /** submitted → revision: a new round with the committee's request (rounds are kept). */
    requestRevision: decision(
      "recruitment.review",
      Ref.extend({ request: RevisionRequestSchema }).strict(),
      ({ request }, userId) =>
        () => ({ status: "revision", revision: { request, requestedBy: userId } }),
    ),
    /** submitted → admin_rejected (fails the document check). */
    fail: decision("recruitment.review", Ref, to("admin_rejected")),
    /** submitted → interview. */
    pass: decision("recruitment.review", Ref, to("interview")),
    /** interview | offered | accepted → rejected (an accepted seat is given back). */
    reject: decision("recruitment.review", Ref, to("rejected")),
    /** interview | offered → offered: one unit, valid for the recruitment's offer days. */
    offer: decision(
      "recruitment.offer",
      Ref.extend({ orgUnitId: safeId }).strict(),
      ({ orgUnitId }, _userId, now) =>
        (_application, recruitment) => ({
          status: "offered",
          offer: makeOffer(recruitment, orgUnitId, now),
        }),
    ),

    /** A short-lived link to the applicant's portfolio or a file answer (recruitment.review). */
    fileUrl: createGuardedAction({
      permission: "recruitment.review",
      input: z.object({ id: safeId, path: z.string().max(400) }).strict(),
      handler: async ({ id, path }) => {
        const application = await deps.applications.get(id);
        const files = [
          application?.portfolio,
          ...Object.values(application?.answers ?? {}).filter(
            (a): a is FileAnswer => typeof a === "object" && !Array.isArray(a),
          ),
        ];
        // Only a file that belongs to this application can be opened.
        if (!files.some((f) => f?.path === path)) {
          throw new RuleViolationError("This file does not belong to the application.");
        }
        return { url: await deps.signedUrl(path) };
      },
    }),
  };
}
