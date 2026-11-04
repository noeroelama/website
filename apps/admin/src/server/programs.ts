import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { LpjAudit, ProgramAudit, SqlProgramStore } from "@website/db/sql";
import {
  approveProgram,
  cancelProgram,
  CheckinInputSchema,
  completeMilestone,
  finishProgram,
  HealthInputSchema,
  MAX_PICS,
  MilestoneInputSchema,
  ProgramInputSchema,
  removeMilestone,
  returnProgram,
  setHealth,
  startProgram,
  upsertMilestone,
  weekStartUtc,
  type LpjReport,
  type Program,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ProgramDeps {
  readonly programs: Pick<
    SqlProgramStore,
    "get" | "create" | "update" | "transition" | "checkIn" | "finish"
  >;
  /** `orgUnitPath` of a unit (unit + ancestors), null when it does not exist. */
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  /** The account uid of an e-mail (PICs are named by e-mail), null when there is none. */
  readonly findUserId: (email: string) => Promise<string | null>;
  /** After finishing: tells the PICs their LPJ is open and when it is due (never throws). */
  readonly afterLpj: (lpj: LpjReport) => Promise<void>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

/**
 * Who runs a programme (milestones, health, check-ins, LPJ): the persons listed on it as PIC,
 * or whoever may edit the programmes of its unit. Being a PIC is not a role (DECISIONS §24): a
 * staff member named PIC needs no unit-wide permission to update their own programme.
 */
export function canManageProgram(
  principal: Principal,
  program: Pick<Program, "pics" | "orgUnitPath">,
): boolean {
  return (
    principal.active &&
    (program.pics.includes(principal.userId) ||
      can(principal, "programs.edit", { orgUnitPath: program.orgUnitPath }))
  );
}

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();
const WithNote = Ref.extend({ note: safeText(1000, { multiline: true }) }).strict();
const SaveProgram = z
  .object({
    id: safeId.optional(),
    version: version.nullable(),
    /** New programmes only: the period they belong to. */
    periodId: safeId,
    plan: ProgramInputSchema,
    picEmails: z.array(z.email("Enter the PIC's account e-mail.").max(254)).max(MAX_PICS),
  })
  .strict();
const SaveMilestone = MilestoneInputSchema.extend({
  id: safeId,
  version,
  milestoneId: safeId.optional(),
}).strict();
const MilestoneRef = Ref.extend({ milestoneId: safeId }).strict();
const CompleteMilestone = MilestoneRef.extend({ done: z.boolean() }).strict();
const SetHealth = HealthInputSchema.extend({ id: safeId, version }).strict();
const CheckIn = CheckinInputSchema.extend({ id: safeId }).strict();

const programAudit =
  (audit: AuditBuilder, action: AuditAction): ProgramAudit =>
  (before, after, current, next) =>
    audit({
      module: "programs",
      action,
      resourceType: "program",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      // Workflow steps and computed progress are never undone by a revert.
      revertible: false,
    });

/** Audit entry builder for LPJ changes (also used by the programme's finish, which opens it). */
export const lpjAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE"): LpjAudit =>
  (before, after, current, next) =>
    audit({
      module: "lpj",
      action,
      resourceType: "lpj",
      resourceId: next.id,
      title: next.plan.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      // Desks and submissions are never undone by a revert: return the LPJ instead.
      revertible: false,
    });

/**
 * Programmes page (E2, E3). Scope: `orgUnit` (a unit assignment covers its unit and the units
 * below it). Plans: `programs.edit` of the unit. Approve / return / cancel: `programs.approve`.
 * Running it (start, finish, milestones, health, check-ins): `canManageProgram`, for staff who
 * can read the programme.
 */
export function createProgramActions(deps: ProgramDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.programs.get(id))?.orgUnitPath ?? [],
  });
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });
  const managed =
    (principal: Principal, step: (program: Program) => Program) => (program: Program) => {
      if (!canManageProgram(principal, program)) {
        throw new RuleViolationError("Only the programme's PICs or its unit can do this.");
      }
      return step(program);
    };

  const resolvePics = async (emails: readonly string[]): Promise<string[]> => {
    const uids: string[] = [];
    for (const email of new Set(emails.map((e) => e.toLowerCase()))) {
      const uid = await deps.findUserId(email);
      if (!uid) throw new RuleViolationError(`No account uses ${email}.`);
      uids.push(uid);
    }
    return [...new Set(uids)];
  };

  const save = createGuardedAction({
    permission: "programs.edit",
    input: SaveProgram,
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.plan.orgUnitId)),
    handler: async ({ id, version, periodId, plan, picEmails }, principal, audit) => {
      const now = deps.now();
      const pics = await resolvePics(picEmails);
      if (!id) {
        const saved = await deps.programs.create(
          periodId,
          plan,
          pics,
          principal.userId,
          programAudit(audit, "CREATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      if (!can(principal, "programs.edit", await unitScope(plan.orgUnitId))) {
        throw new RuleViolationError("You can only plan programmes of your own unit.");
      }
      const saved = await deps.programs.update(
        id,
        version as number,
        plan,
        pics,
        programAudit(audit, "UPDATE"),
        now,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  /** One workflow step on one programme; `manage` = PIC rule instead of the permission alone. */
  const step = <S extends z.ZodType<{ id: string; version: number }>>(
    permission: "programs.approve" | "programs.read",
    input: S,
    decide: (program: Program, input: z.infer<S>, principal: Principal, now: Date) => Program,
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async (parsed, principal, audit) => {
        const now = deps.now();
        const apply = (program: Program) => decide(program, parsed, principal, now);
        const saved = await deps.programs.transition(
          parsed.id,
          parsed.version,
          permission === "programs.read" ? managed(principal, apply) : apply,
          programAudit(audit, "UPDATE"),
          now,
        );
        return { version: saved.version, status: saved.status, progress: saved.progressPercent };
      },
    });

  const approve = step("programs.approve", Ref, (p, _i, principal, now) =>
    approveProgram(p, principal.userId, now),
  );
  const returnToProposal = step("programs.approve", WithNote, (p, i) => returnProgram(p, i.note));
  const cancel = step("programs.approve", WithNote, (p, i, _principal, now) =>
    cancelProgram(p, i.note, now),
  );
  const start = step("programs.read", Ref, (p, _i, _principal, now) => startProgram(p, now));
  /** running → finished, and the LPJ opens in the same transaction (frozen plan, due date). */
  const finish = createGuardedAction({
    permission: "programs.read",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, principal, audit) => {
      const now = deps.now();
      const { program, lpj } = await deps.programs.finish(
        id,
        version,
        managed(principal, (p) => finishProgram(p, now)),
        programAudit(audit, "UPDATE"),
        lpjAudit(audit, "CREATE"),
        now,
      );
      await deps.afterLpj(lpj);
      return {
        version: program.version,
        status: program.status,
        progress: program.progressPercent,
      };
    },
  });
  const health = step("programs.read", SetHealth, (p, i, principal, now) =>
    setHealth(p, i.health, i.reason, principal.userId, now),
  );
  const saveMilestone = step("programs.read", SaveMilestone, (p, i) => {
    const { title, dueOn, weight, sort } = i;
    return upsertMilestone(p, i.milestoneId ?? deps.uuid(), { title, dueOn, weight, sort });
  });
  const deleteMilestone = step("programs.read", MilestoneRef, (p, i) =>
    removeMilestone(p, i.milestoneId),
  );
  const markMilestone = step("programs.read", CompleteMilestone, (p, i, principal, now) =>
    completeMilestone(p, i.milestoneId, i.done, principal.userId, now),
  );

  /** This UTC week's check-in; sending again the same week updates it. */
  const checkIn = createGuardedAction({
    permission: "programs.read",
    input: CheckIn,
    resource: scopeOf,
    handler: async ({ id, ...report }, principal, audit) => {
      const program = await deps.programs.get(id);
      if (!program || !canManageProgram(principal, program)) {
        throw new RuleViolationError("Only the programme's PICs or its unit can do this.");
      }
      const now = deps.now();
      const saved = await deps.programs.checkIn(
        id,
        weekStartUtc(now),
        report,
        principal.userId,
        (before, after, current, checkin) =>
          audit({
            module: "programs",
            action: before ? "UPDATE" : "CREATE",
            resourceType: "checkin",
            resourceId: checkin.id,
            title: `${current.name} · ${checkin.weekStart}`,
            before,
            after,
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        now,
      );
      return { id: saved.id, weekStart: saved.weekStart };
    },
  });

  return {
    save,
    approve,
    returnToProposal,
    cancel,
    start,
    finish,
    health,
    saveMilestone,
    deleteMilestone,
    markMilestone,
    checkIn,
  };
}
