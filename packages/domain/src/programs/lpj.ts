import { z } from "zod";
import { safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta, type Money } from "../shared";
import { BudgetsSchema, type Program } from "./programs";

export const LPJ_STATUSES = ["draft", "submitted", "returned", "approved"] as const;
export type LpjStatus = (typeof LPJ_STATUSES)[number];

export const LPJ_DESKS = ["secretariat", "treasurer", "approval"] as const;
export type LpjDesk = (typeof LPJ_DESKS)[number];

export const LPJ_DESK_PERMISSIONS = {
  secretariat: "lpj.review_secretariat",
  treasurer: "lpj.review_treasurer",
  approval: "lpj.approve",
} as const satisfies Record<LpjDesk, string>;

export const DEFAULT_LPJ_DEADLINE_DAYS = 14;

export interface LpjDeskSignature {
  readonly uid: string;
  readonly at: Date;
}

export interface PlanSnapshot {
  readonly name: string;
  readonly goal: string;
  readonly description: string;
  readonly unitName: string;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly budgets: readonly Money[];
  readonly pics: readonly string[];
  readonly progressPercent: number;
  readonly milestones: ReadonlyArray<{
    readonly title: string;
    readonly dueOn: string | null;
    readonly weight: number;
    readonly done: boolean;
  }>;
  readonly startedAt: Date | null;
  readonly finishedAt: Date;
}

export const LpjInputSchema = z
  .object({
    realization: safeText(8000, { multiline: true, allowEmpty: true }),
    obstacles: safeText(4000, { multiline: true, allowEmpty: true }),
    recommendations: safeText(4000, { multiline: true, allowEmpty: true }),
    participantCount: z.number().int().min(0).max(1_000_000).nullable(),
    realized: BudgetsSchema.nullable(),
  })
  .strict();
export type LpjInput = z.infer<typeof LpjInputSchema>;

export interface LpjReport extends LpjInput, EntityMeta {
  readonly programId: string;
  readonly periodId: string;
  readonly orgUnitPath: readonly string[];
  readonly pics: readonly string[];
  readonly plan: PlanSnapshot;
  readonly dueOn: string;
  readonly status: LpjStatus;
  readonly submittedBy: string | null;
  readonly submittedAt: Date | null;
  readonly returnNote: string | null;
  readonly revisionRound: number;
  readonly secretariat: LpjDeskSignature | null;
  readonly treasurer: LpjDeskSignature | null;
  readonly approval: LpjDeskSignature | null;
}

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type LpjFields = Omit<LpjReport, Meta>;

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

export function addDaysUtc(from: Date, days: number): string {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function openLpj(
  program: Program,
  unitName: string,
  deadlineDays: number,
  now: Date,
): LpjFields {
  if (program.status !== "finished") refuse("The LPJ opens when the programme is finished.");
  return {
    programId: program.id,
    periodId: program.periodId,
    orgUnitPath: [...program.orgUnitPath],
    pics: [...program.pics],
    plan: {
      name: program.name,
      goal: program.goal,
      description: program.description,
      unitName,
      plannedStart: program.plannedStart,
      plannedEnd: program.plannedEnd,
      budgets: program.budgets.map((b) => ({ ...b })),
      pics: [...program.pics],
      progressPercent: program.progressPercent,
      milestones: program.milestones.map((m) => ({
        title: m.title,
        dueOn: m.dueOn,
        weight: m.weight,
        done: m.completedAt !== null,
      })),
      startedAt: program.startedAt,
      finishedAt: program.finishedAt as Date,
    },
    dueOn: addDaysUtc(now, deadlineDays),
    status: "draft",
    realization: "",
    obstacles: "",
    recommendations: "",
    participantCount: null,
    realized: null,
    submittedBy: null,
    submittedAt: null,
    returnNote: null,
    revisionRound: 0,
    secretariat: null,
    treasurer: null,
    approval: null,
    deletedAt: null,
  };
}

const isWritable = (lpj: Pick<LpjReport, "status">) =>
  lpj.status === "draft" || lpj.status === "returned";

export function editLpj(lpj: LpjReport, input: LpjInput): LpjReport {
  if (!isWritable(lpj)) refuse("A submitted LPJ cannot be edited; ask a reviewer to return it.");
  return { ...lpj, ...input };
}

export function missingLpjFields(lpj: LpjInput): string[] {
  return [
    !lpj.realization.trim() && "Realization",
    !lpj.obstacles.trim() && "Obstacles",
    !lpj.recommendations.trim() && "Recommendations",
    lpj.realized === null && "Money spent",
  ].filter((field): field is string => typeof field === "string");
}

export function submitLpj(lpj: LpjReport, uid: string, now: Date): LpjReport {
  if (!isWritable(lpj)) refuse("This LPJ is already submitted.");
  const missing = missingLpjFields(lpj);
  if (missing.length > 0) refuse(`Complete first: ${missing.join(", ")}.`);
  return { ...lpj, status: "submitted", submittedBy: uid, submittedAt: now, returnNote: null };
}

export function signLpj(lpj: LpjReport, desk: LpjDesk, uid: string, now: Date): LpjReport {
  if (lpj.status !== "submitted") refuse("Only a submitted LPJ can be reviewed.");
  if (lpj[desk]) refuse("This desk has already signed.");
  if (uid === lpj.submittedBy) refuse("The submitter cannot review their own LPJ.");
  if (LPJ_DESKS.some((d) => d !== desk && lpj[d]?.uid === uid)) {
    refuse("One person cannot hold two desks of the same LPJ.");
  }
  if (desk === "treasurer" && lpj.realized === null) {
    refuse("Money spent is not filled in; there is nothing to check.");
  }
  if (desk === "approval" && (!lpj.secretariat || !lpj.treasurer)) {
    refuse("Both reviews (secretariat and treasurer) come before the approval.");
  }
  const signed = { ...lpj, [desk]: { uid, at: now } };
  return desk === "approval" ? { ...signed, status: "approved" } : signed;
}

export function returnLpj(lpj: LpjReport, note: string): LpjReport {
  if (lpj.status !== "submitted") refuse("Only a submitted LPJ can be returned.");
  if (!note.trim()) refuse("Say what must be fixed.");
  return {
    ...lpj,
    status: "returned",
    returnNote: note.trim(),
    revisionRound: lpj.revisionRound + 1,
    secretariat: null,
    treasurer: null,
    approval: null,
  };
}

export function extendLpjDue(lpj: LpjReport, dueOn: string): LpjReport {
  if (lpj.status === "approved") refuse("The LPJ is approved; its due date no longer matters.");
  return { ...lpj, dueOn };
}

export const isOverdue = (lpj: Pick<LpjReport, "status" | "dueOn">, now: Date): boolean =>
  lpj.status !== "approved" && now.toISOString().slice(0, 10) > lpj.dueOn;
