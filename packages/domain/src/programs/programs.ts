import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta, type Money } from "../shared";

/**
 * Work programmes (E2) and weekly check-ins (E3), ported from PPIDK `ProkerService`,
 * `MilestoneService` and `CheckinService`:
 *
 *   proposed ──→ approved ──→ running ──→ finished
 *      ↑            │
 *      └────────────┘  returned with a note (the approval is withdrawn)
 *   cancelled ← from any of the first three, with a reason
 *
 * Progress is never typed: it is the weight of the completed milestones over the weight of all
 * of them, recomputed in the same write as any milestone change. Health always comes with its
 * reason. Who runs a programme is whoever is listed on it as PIC (`canManageProgram` in admin),
 * not a role.
 */
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

/** Approved or running: the programme has a health status and weekly check-ins. */
export const isUnderway = (status: ProgramStatus): boolean =>
  status === "approved" || status === "running";
/** The plan and milestones change until the programme is closed. */
export const isClosed = (status: ProgramStatus): boolean =>
  status === "finished" || status === "cancelled";

const plainDate = z.iso.date();

/** One budget line per currency (JPY, KRW, AUD, TWD, IDR …), never converted (DECISIONS §27). */
export const BudgetLineSchema = z
  .object({
    amountMinor: z.number().int().min(0).max(1e13),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use the 3-letter currency code, e.g. JPY."),
  })
  .strict();

/** Decimals of a currency's minor unit (ISO 4217 via Intl: JPY 0, IDR 2, AUD 2). */
export const minorDigits = (currency: string): number =>
  // Always set for style "currency".
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;

/** "JPY 50,000" / "AUD 12.50": the amount in major units with its code (no conversion). */
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
    /** The proposing unit (of the programme's period). */
    orgUnitId: safeId,
    /** The key result it serves (an objective of the same period), or none yet. */
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
    /** Organising a committee is not as big as holding the event: weights, not counts. */
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
  /** Uids of the persons in charge; they run the programme (milestones, health, check-ins, LPJ). */
  readonly pics: readonly string[];
  readonly status: ProgramStatus;
  /** Always computed from the milestones (`withProgress`), never typed. */
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

/** Weighted share of completed milestones, 0-100; none = 0 (no plan is not a finished job). */
export function progressPercent(milestones: readonly Pick<Milestone, "weight" | "completedAt">[]) {
  const total = milestones.reduce((sum, m) => sum + m.weight, 0);
  if (total === 0) return 0;
  const done = milestones.reduce((sum, m) => sum + (m.completedAt ? m.weight : 0), 0);
  return Math.round((done / total) * 100);
}

/** The programme with its milestones in order and `progressPercent` recomputed from them. */
export function withProgress(program: Program, milestones: readonly Milestone[]): Program {
  const ordered = [...milestones].sort(
    (a, b) => a.sort - b.sort || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"),
  );
  return { ...program, milestones: ordered, progressPercent: progressPercent(ordered) };
}

/** Plan edits keep the status; a closed programme is history. */
export function assertPlanEditable(program: Program): void {
  assertOpen(program);
}

export function approveProgram(program: Program, uid: string, now: Date): Program {
  assertStatus(program, ["proposed"], "Only proposals can be approved.");
  if (program.pics.length === 0) refuse("Name the person in charge (PIC) before approving.");
  return { ...program, status: "approved", approvedBy: uid, approvedAt: now, reviewNote: null };
}

/** Back to proposed with a note; the approval is withdrawn (it is no longer what was approved). */
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

/** Running needs a plan: at least one milestone (progress comes only from milestones). */
export function startProgram(program: Program, now: Date): Program {
  assertStatus(program, ["approved"], "Approve the programme before it starts.");
  if (program.milestones.length === 0) refuse("Add at least one milestone first.");
  return { ...program, status: "running", startedAt: program.startedAt ?? now };
}

/** Open milestones do not block: what was not done is what the LPJ explains. */
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

/** Health with its reason, every time (also "on track"). */
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

/** Marks a milestone done, or opens it again (marked too early: progress drops, which is true). */
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

/* ---- Weekly check-in (E3) ---- */

/**
 * Monday of the week of `instant`, in UTC (YYYY-MM-DD). The region spans UTC+5:30 to UTC+13: one
 * line for the whole organisation, so "who has not checked in this week" has one answer.
 */
export function weekStartUtc(instant: Date): string {
  const day = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** `programCheckins/{programId}_{weekStartUtc}`: one per programme per week; sending again updates. */
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

/** Only approved or running programmes report weekly. */
export function assertCanCheckIn(program: Pick<Program, "status">): void {
  if (!isUnderway(program.status)) {
    refuse("Check-ins are for approved or running programmes.");
  }
}
