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
  isRecruitmentOpen,
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
  readonly appointments: Pick<SqlAppointmentStore, "getRoleMap">;
  readonly units: { get(id: string): Promise<OrgUnit | null> };
  readonly roles: Pick<SqlRoleStore, "getMany">;
  readonly hasSecondFactor: (uid: string) => Promise<boolean>;
  readonly afterRoleChange: (actor: Principal, uid: string, details: object) => Promise<void>;
  readonly signedUrl: (path: string) => Promise<string>;
  readonly notify: (application: Application, recruitmentTitle: string) => Promise<void>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

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
        let title = "";
        const next = await deps.applications.decide(
          parsed.id,
          parsed.version,
          (application, recruitment) => {
            title = recruitment.title;
            return decide(parsed, principal.userId, now)(application, recruitment);
          },
          decisionAudit(audit),
          now,
        );
        await deps.notify(next, title);
        return { status: next.status, version: next.version };
      },
    });

  const to = (status: ApplicationStatus) => () => () => ({ status });

  return {
    requestRevision: decision(
      "recruitment.review",
      Ref.extend({ request: RevisionRequestSchema }).strict(),
      ({ request }, userId, now) =>
        (_application, recruitment) => {
          if (!isRecruitmentOpen(recruitment, now)) {
            throw new RuleViolationError(
              "The application window has closed, so the applicant could not send a revision.",
            );
          }
          return { status: "revision", revision: { request, requestedBy: userId } };
        },
    ),
    fail: decision("recruitment.review", Ref, to("admin_rejected")),
    pass: decision("recruitment.review", Ref, to("interview")),
    reject: decision("recruitment.review", Ref, to("rejected")),
    offer: decision(
      "recruitment.offer",
      Ref.extend({ orgUnitId: safeId }).strict(),
      ({ orgUnitId }, _userId, now) =>
        (_application, recruitment) => ({
          status: "offered",
          offer: makeOffer(recruitment, orgUnitId, now),
        }),
    ),

    approve: decision("recruitment.confirm", Ref, to("approved")),
    returnPact: decision(
      "recruitment.review",
      Ref.extend({ note: PactNoteSchema }).strict(),
      ({ note }) =>
        (application) => {
          if (application.status !== "pakta_review") {
            throw new RuleViolationError("Only a pact in review can be sent back.");
          }
          return { status: "approved", pactNote: note };
        },
    ),

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
            "Set the appointment roles first (Role Manager → Edit Role → Roles from appointments).",
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
        let recruitmentTitle = "";
        const result = await deps.applications.ratify(
          id,
          version,
          { title },
          derived,
          {
            appointment: appointmentAudit,
            application: (...args) => {
              recruitmentTitle = args[4];
              return decisionAudit(audit)(...args);
            },
          },
          deps.now(),
        );
        await deps.notify(result.application, recruitmentTitle);
        await deps.afterRoleChange(principal, application.userId, {
          appointment: result.appointment.id,
          application: id,
        });
        return { status: result.application.status, appointmentId: result.appointment.id };
      },
    }),

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
        if (!files.some((f) => f?.path === path)) {
          throw new RuleViolationError("This file does not belong to the application.");
        }
        return { url: await deps.signedUrl(path) };
      },
    }),
  };
}
