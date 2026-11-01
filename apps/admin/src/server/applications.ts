import "server-only";
import { z } from "zod";
import type {
  AppointmentAudit,
  Decision,
  SqlApplicationStore,
  SqlAppointmentStore,
  SqlRoleStore,
} from "@website/db/sql";
import { derivedAssignments, type OrgUnit } from "@website/domain/organizations";
import type { FileAnswer } from "@website/domain/forms";
import {
  makeOffer,
  PactNoteSchema,
  RevisionRequestSchema,
  type Application,
  type ApplicationStatus,
  type Recruitment,
} from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { canRatifyInto, type PagePermission, type Principal } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ApplicationDeps {
  readonly applications: Pick<SqlApplicationStore, "decide" | "get" | "ratify">;
  /** Ratification creates the appointment through the step 3.7 rules (roles, escalation, MFA). */
  readonly appointments: Pick<SqlAppointmentStore, "getRoleMap">;
  readonly units: { get(id: string): Promise<OrgUnit | null> };
  readonly roles: Pick<SqlRoleStore, "getMany">;
  /** True when the account has a second sign-in method (staff roles need it). */
  readonly hasSecondFactor: (uid: string) => Promise<boolean>;
  /** Sessions revoked + `staff.role_changed` security event, after the roles changed. */
  readonly afterRoleChange: (actor: Principal, uid: string, details: object) => Promise<void>;
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

    /** accepted → approved: the Sekjen approves the placement (recruitment.confirm). */
    approve: decision("recruitment.confirm", Ref, to("approved")),
    /** pakta_review → approved with a note: the pact goes back; every uploaded file is kept. */
    returnPact: decision(
      "recruitment.review",
      Ref.extend({ note: PactNoteSchema }).strict(),
      ({ note }) =>
        () => ({ status: "approved", pactNote: note }),
    ),

    /**
     * pakta_review → confirmed (recruitment.confirm, the Sekjen) and, in the SAME transaction,
     * the appointment to the offered unit as a member seat through the step 3.7 rules: the
     * derived roles must not exceed the ratifier's own, staff roles need a second sign-in
     * method, nobody ratifies themselves. Afterwards the applicant's sessions are renewed.
     */
    ratify: createGuardedAction({
      permission: "recruitment.confirm",
      input: Ref.extend({
        title: safeText(120).pipe(z.string().min(2, "Enter the title of the seat.")),
      }).strict(),
      recentSignIn: true,
      handler: async ({ id, version, title }, principal, audit) => {
        const application = await deps.applications.get(id);
        if (!application?.offer) throw new RuleViolationError("This application has no placement.");
        if (application.userId === principal.userId) {
          throw new RuleViolationError("You cannot ratify your own application.");
        }
        const [unit, stored] = await Promise.all([
          deps.units.get(application.offer.orgUnitId),
          deps.appointments.getRoleMap(),
        ]);
        if (!stored) {
          throw new RuleViolationError(
            "Set the appointment roles first (Roles from appointments).",
          );
        }
        if (!unit) throw new RuleViolationError("This unit does not exist.");
        const derived = derivedAssignments("member", unit, stored.map);
        const roles = await deps.roles.getMany(derived.map((d) => d.roleId));
        for (const { roleId } of derived) {
          const role = roles.get(roleId);
          if (!role) throw new RuleViolationError(`The role "${roleId}" does not exist.`);
          if (!canRatifyInto(principal, role)) {
            throw new RuleViolationError(
              "You can only give roles whose permissions you hold yourself.",
            );
          }
        }
        if (
          [...roles.values()].some((role) => role.permissions.length > 0) &&
          !(await deps.hasSecondFactor(application.userId))
        ) {
          throw new RuleViolationError(
            "This account needs a second sign-in method first: two-step verification, or a passkey plus Google or a password (web → Your account).",
          );
        }
        const appointmentAudit: AppointmentAudit = (appointment, account) => [
          audit({
            module: "appointments",
            action: "CREATE",
            resourceType: "appointment",
            resourceId: appointment.next.id,
            title: `${appointment.next.title} — ${appointment.next.name}`,
            before: null,
            after: appointment.after,
            versionBefore: null,
            versionAfter: appointment.next.version,
            revertible: false,
          }),
          audit({
            module: "users",
            action: "UPDATE",
            resourceType: "user",
            resourceId: account.user.uid,
            title: account.user.email ?? account.user.uid,
            ...account.change,
            revertible: false,
          }),
        ];
        const result = await deps.applications.ratify(
          id,
          version,
          { title },
          derived,
          { appointment: appointmentAudit, application: decisionAudit(audit) },
          deps.now(),
        );
        await deps.afterRoleChange(principal, application.userId, {
          appointment: result.appointment.id,
          application: id,
        });
        return { status: result.application.status, appointmentId: result.appointment.id };
      },
    }),

    /** A short-lived link to a portfolio, pact or file answer of the application (recruitment.review). */
    fileUrl: createGuardedAction({
      permission: "recruitment.review",
      input: z.object({ id: safeId, path: z.string().max(400) }).strict(),
      handler: async ({ id, path }) => {
        const application = await deps.applications.get(id);
        const files = [
          application?.portfolio,
          ...(application?.pacts ?? []),
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
