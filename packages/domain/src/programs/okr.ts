import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { canChangePeriod, type Period } from "../organizations";
import { RuleViolationError, type EntityMeta } from "../shared";

export const KEY_RESULT_DIRECTIONS = ["up", "down"] as const;
export type KeyResultDirection = (typeof KEY_RESULT_DIRECTIONS)[number];

const amount = z.number().finite().min(-1e12).max(1e12);

export const KeyResultInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(2, "Enter the key result.")),
    unit: safeText(32, { allowEmpty: true }).default(""),
    baseline: amount.default(0),
    target: amount,
    current: amount.default(0),
    direction: z.enum(KEY_RESULT_DIRECTIONS).default("up"),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type KeyResultInput = z.infer<typeof KeyResultInputSchema>;

export interface KeyResult extends KeyResultInput {
  readonly id: string;
  readonly measuredAt: Date | null;
}

export const ObjectiveInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(2, "Enter the objective.")),
    description: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
    orgUnitId: safeId.nullable(),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type ObjectiveInput = z.infer<typeof ObjectiveInputSchema>;

export interface Objective extends ObjectiveInput, EntityMeta {
  readonly periodId: string;
  readonly orgUnitPath: readonly string[];
  readonly keyResults: readonly KeyResult[];
}

export const VisionInputSchema = z
  .object({
    vision: safeText(2000, { multiline: true, allowEmpty: true }),
    mission: safeText(4000, { multiline: true, allowEmpty: true }),
  })
  .strict();

export const MAX_KEY_RESULTS = 20;

export function assertOkrWritable(period: Pick<Period, "status" | "deletedAt"> | null): void {
  if (!period || period.deletedAt) throw new RuleViolationError("This period does not exist.");
  if (!canChangePeriod(period.status)) {
    throw new RuleViolationError("This period is archived; its plans can no longer change.");
  }
}

export function keyResultPercent(
  kr: Pick<KeyResult, "baseline" | "target" | "current" | "direction">,
): number {
  const range = kr.target - kr.baseline;
  if (Math.abs(range) < 0.00001) {
    const off = kr.direction === "down" ? kr.current > kr.target : kr.current < kr.target;
    return off ? 0 : 100;
  }
  const percent = ((kr.current - kr.baseline) / range) * 100;
  return Math.round(Math.max(0, Math.min(100, percent)));
}

export function objectivePercent(objective: Pick<Objective, "keyResults">): number {
  const krs = objective.keyResults;
  if (krs.length === 0) return 0;
  return Math.round(krs.reduce((sum, kr) => sum + keyResultPercent(kr), 0) / krs.length);
}

export function upsertKeyResult(
  objective: Objective,
  id: string,
  input: KeyResultInput,
  now: Date,
): Objective {
  const previous = objective.keyResults.find((kr) => kr.id === id);
  if (!previous && objective.keyResults.length >= MAX_KEY_RESULTS) {
    throw new RuleViolationError(`At most ${MAX_KEY_RESULTS} key results per objective.`);
  }
  const measuredAt = previous?.current === input.current ? previous.measuredAt : now;
  const next: KeyResult = { ...input, id, measuredAt };
  const keyResults = previous
    ? objective.keyResults.map((kr) => (kr.id === id ? next : kr))
    : [...objective.keyResults, next];
  return { ...objective, keyResults: [...keyResults].sort((a, b) => a.sort - b.sort) };
}

export function removeKeyResult(objective: Objective, id: string): Objective {
  if (!objective.keyResults.some((kr) => kr.id === id)) {
    throw new RuleViolationError("This key result does not exist.");
  }
  return { ...objective, keyResults: objective.keyResults.filter((kr) => kr.id !== id) };
}
