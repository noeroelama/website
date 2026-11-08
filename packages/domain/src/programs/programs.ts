import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta, type Money } from "../shared";

export const PROGRAM_STATUSES = [
  "proposed",
  "approved",
  "running",
  "finished",
  "cancelled",
] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const HEALTH_STATUSES = ["on_track", "at_risk", "off_track"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const isUnderway = (status: ProgramStatus): boolean =>
  status === "approved" || status === "running";
export const isClosed = (status: ProgramStatus): boolean =>
  status === "finished" || status === "cancelled";

const plainDate = z.iso.date();

export const BudgetLineSchema = z
  .object({
    amountMinor: z.number().int().min(0).max(1e13),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use the 3-letter currency code, e.g. JPY."),
  })
  .strict();

export const minorDigits = (currency: string): number =>
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;

export function formatMoney(m: Money): string {
  const digits = minorDigits(m.currency);
  const amount = (m.amountMinor / 10 ** digits).toLocaleString("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${m.currency} ${amount}`;
}

export const BudgetsSchema = z
  .array(BudgetLineSchema)
  .max(6, "At most 6 currencies.")
  .refine(
    (lines) => new Set(lines.map((l) => l.currency)).size === lines.length,
    "One line per currency: add the amounts of the same currency together.",
  );

export const ProgramInputSchema = z
  .object({
    name: safeText(200).pipe(z.string().min(3, "Enter the programme name.")),
    goal: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
    description: safeText(4000, { multiline: true, allowEmpty: true }).default(""),
    orgUnitId: safeId,
    objectiveId: safeId.nullable().default(null),
    keyResultId: safeId.nullable().default(null),
    plannedStart: plainDate.nullable().default(null),
    plannedEnd: plainDate.nullable().default(null),
    budgets: BudgetsSchema.default([]),
  })
  .strict()
  .refine((p) => (p.objectiveId === null) === (p.keyResultId === null), {
    message: "Choose the key result, or none.",
    path: ["keyResultId"],
  })
  .refine((p) => !p.plannedStart || !p.plannedEnd || p.plannedStart <= p.plannedEnd, {
    message: "The end is before the start.",
    path: ["plannedEnd"],
  });
export type ProgramInput = z.infer<typeof ProgramInputSchema>;

export const MilestoneInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(2, "Enter the milestone.")),
    dueOn: plainDate.nullable().default(null),
    weight: z.number().int().min(1).max(100).default(1),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type MilestoneInput = z.infer<typeof MilestoneInputSchema>;

export interface Milestone extends MilestoneInput {
  readonly id: string;
  readonly completedAt: Date | null;
  readonly completedBy: string | null;
}

export interface Health {
  readonly status: HealthStatus;
  readonly reason: string;
  readonly at: Date;
  readonly by: string;
}

export const HealthInputSchema = z
  .object({
    health: z.enum(HEALTH_STATUSES),
    reason: safeText(1000, { multiline: true }).pipe(z.string().min(1, "Say why.")),
  })
  .strict();

export interface Program extends EntityMeta {
  readonly periodId: string;
  readonly orgUnitId: string;
  readonly orgUnitPath: readonly string[];
  readonly objectiveId: string | null;
  readonly keyResultId: string | null;
  readonly name: string;
  readonly goal: string;
  readonly description: string;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly budgets: readonly Money[];
  readonly pics: readonly string[];
  readonly status: ProgramStatus;
  readonly progressPercent: number;
  readonly milestones: readonly Milestone[];
  readonly health: Health | null;
  readonly reviewNote: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly createdBy: string;
}

export const MAX_MILESTONES = 50;
export const MAX_PICS = 10;

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};
function assertStatus(program: Program, allowed: readonly ProgramStatus[], message: string) {
  if (!allowed.includes(program.status)) refuse(message);
}
function assertOpen(program: Program) {
  if (isClosed(program.status)) refuse("This programme is closed; it can no longer change.");
}

export function progressPercent(milestones: readonly Pick<Milestone, "weight" | "completedAt">[]) {
  const total = milestones.reduce((sum, m) => sum + m.weight, 0);
  if (total === 0) return 0;
  const done = milestones.reduce((sum, m) => sum + (m.completedAt ? m.weight : 0), 0);
  return Math.round((done / total) * 100);
}

export function withProgress(program: Program, milestones: readonly Milestone[]): Program {
  const ordered = [...milestones].sort(
    (a, b) => a.sort - b.sort || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"),
  );
  return { ...program, milestones: ordered, progressPercent: progressPercent(ordered) };
}

export function assertPlanEditable(program: Program): void {
  assertOpen(program);
}

export function approveProgram(program: Program, uid: string, now: Date): Program {
  assertStatus(program, ["proposed"], "Only proposals can be approved.");
  if (program.pics.length === 0) refuse("Name the person in charge (PIC) before approving.");
  return { ...program, status: "approved", approvedBy: uid, approvedAt: now, reviewNote: null };
}

export function returnProgram(program: Program, note: string): Program {
  assertStatus(
    program,
    ["proposed", "approved"],
    "Only proposals or approved programmes can be returned.",
  );
  if (!note.trim()) refuse("Say what must be fixed.");
  return {
    ...program,
    status: "proposed",
    reviewNote: note.trim(),
    approvedBy: null,
    approvedAt: null,
  };
}

export function startProgram(program: Program, now: Date): Program {
  assertStatus(program, ["approved"], "Approve the programme before it starts.");
  if (program.milestones.length === 0) refuse("Add at least one milestone first.");
  return { ...program, status: "running", startedAt: program.startedAt ?? now };
}

export function finishProgram(program: Program, now: Date): Program {
  assertStatus(program, ["running"], "Only running programmes can be finished.");
  return { ...program, status: "finished", finishedAt: now };
}

export function cancelProgram(program: Program, reason: string, now: Date): Program {
  assertStatus(
    program,
    ["proposed", "approved", "running"],
    "A finished programme cannot be cancelled.",
  );
  if (!reason.trim()) refuse("Give the reason for cancelling.");
  return { ...program, status: "cancelled", cancelledAt: now, cancelReason: reason.trim() };
}

export function setHealth(
  program: Program,
  status: HealthStatus,
  reason: string,
  uid: string,
  now: Date,
): Program {
  if (!isUnderway(program.status)) {
    refuse("Only approved or running programmes have a health status.");
  }
  if (!reason.trim()) refuse("Say why.");
  return { ...program, health: { status, reason: reason.trim(), at: now, by: uid } };
}

export function upsertMilestone(program: Program, id: string, input: MilestoneInput): Program {
  assertOpen(program);
  const previous = program.milestones.find((m) => m.id === id);
  if (!previous && program.milestones.length >= MAX_MILESTONES) {
    refuse(`At most ${MAX_MILESTONES} milestones.`);
  }
  const next: Milestone = {
    ...input,
    id,
    completedAt: previous?.completedAt ?? null,
    completedBy: previous?.completedBy ?? null,
  };
  return withProgress(
    program,
    previous
      ? program.milestones.map((m) => (m.id === id ? next : m))
      : [...program.milestones, next],
  );
}

function findMilestone(program: Program, id: string): Milestone {
  return program.milestones.find((m) => m.id === id) ?? refuse("This milestone does not exist.");
}

export function removeMilestone(program: Program, id: string): Program {
  assertOpen(program);
  findMilestone(program, id);
  return withProgress(
    program,
    program.milestones.filter((m) => m.id !== id),
  );
}

export function completeMilestone(
  program: Program,
  id: string,
  done: boolean,
  uid: string,
  now: Date,
): Program {
  assertOpen(program);
  const milestone = findMilestone(program, id);
  const next: Milestone = done
    ? {
        ...milestone,
        completedAt: milestone.completedAt ?? now,
        completedBy: milestone.completedBy ?? uid,
      }
    : { ...milestone, completedAt: null, completedBy: null };
  return withProgress(
    program,
    program.milestones.map((m) => (m.id === id ? next : m)),
  );
}

export function weekStartUtc(instant: Date): string {
  const day = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export const checkinId = (programId: string, weekStart: string): string =>
  `${programId}_${weekStart}`;

export const CheckinInputSchema = z
  .object({
    achievements: safeText(2000, { multiline: true }).pipe(
      z.string().min(1, "Write what was done this week."),
    ),
    blockers: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
    nextPlan: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
  })
  .strict();
export type CheckinInput = z.infer<typeof CheckinInputSchema>;

export interface Checkin extends CheckinInput {
  readonly id: string;
  readonly programId: string;
  readonly periodId: string;
  readonly weekStart: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function assertCanCheckIn(program: Pick<Program, "status">): void {
  if (!isUnderway(program.status)) {
    refuse("Check-ins are for approved or running programmes.");
  }
}
