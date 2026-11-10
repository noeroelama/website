import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import type { Answers, FileAnswer } from "../forms";
import { TimezoneSchema } from "../members/profile";
import { RuleViolationError, wallTimeToUtc, type EntityMeta } from "../shared";

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "revision",
  "admin_rejected",
  "interview",
  "offered",
  "accepted",
  "declined",
  "approved",
  "pakta_review",
  "confirmed",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["revision", "admin_rejected", "interview", "withdrawn"],
  revision: ["submitted", "admin_rejected", "withdrawn"],
  admin_rejected: [],
  interview: ["offered", "rejected", "withdrawn"],
  offered: ["accepted", "declined", "offered", "rejected"],
  accepted: ["approved", "rejected", "withdrawn"],
  declined: [],
  approved: ["pakta_review", "withdrawn"],
  pakta_review: ["approved", "confirmed"],
  confirmed: [],
  rejected: [],
  withdrawn: [],
};

/** Statuses that keep a seat of the offered unit taken (counted in its seat counter). */
export const SEAT_HOLDING_STATUSES: readonly ApplicationStatus[] = [
  "accepted",
  "approved",
  "pakta_review",
  "confirmed",
];

export const holdsSeat = (status: ApplicationStatus): boolean =>
  SEAT_HOLDING_STATUSES.includes(status);

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) {
    throw new RuleViolationError(`An application in "${from}" cannot move to "${to}".`);
  }
}

export const isFinal = (status: ApplicationStatus) => TRANSITIONS[status].length === 0;

export const MAX_CHOICES = 5;
export const MAX_UNITS = 60;
export const MAX_PORTFOLIO_BYTES = 5 * 1024 * 1024;

export interface RecruitmentUnit {
  readonly orgUnitId: string;
  readonly name: string;
  readonly quota: number;
  readonly portfolioRequired: boolean;
}

export interface Recruitment extends EntityMeta {
  readonly periodId: string;
  readonly title: string;
  readonly description: string;
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly maxChoices: number;
  readonly units: readonly RecruitmentUnit[];
  readonly offerDays: number;
  readonly formId: string;
  readonly formVersion: number;
  readonly pactTemplateUrl: string | null;
  readonly published: boolean;
}

export interface Booking {
  readonly slotId: string;
  readonly startsAt: Date;
}

export interface Offer {
  readonly orgUnitId: string;
  readonly expiresAt: Date;
}

export interface Application {
  readonly id: string;
  readonly recruitmentId: string;
  readonly userId: string;
  readonly status: ApplicationStatus;
  readonly choices: readonly string[];
  readonly answers: Answers;
  readonly portfolio: FileAnswer | null;
  readonly revisionRound: number;
  readonly offer: Offer | null;
  readonly interview: Booking | null;
  readonly pacts: readonly FileAnswer[];
  readonly pactNote: string | null;
  readonly appointmentId: string | null;
  readonly submittedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const applicationId = (recruitmentId: string, userId: string) =>
  `${recruitmentId}_${userId}`;
export const seatCounterId = (recruitmentId: string, orgUnitId: string) =>
  `${recruitmentId}_${orgUnitId}`;

const date = z.coerce.date({ error: "Enter a date and time." });

export const RecruitmentUnitInputSchema = z
  .object({
    orgUnitId: safeId,
    quota: z.number().int().min(1, "At least 1 seat.").max(500),
    portfolioRequired: z.boolean(),
  })
  .strict();

export const RecruitmentInputSchema = z
  .object({
    periodId: safeId,
    title: safeText(160).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    description: safeText(5000, { multiline: true, allowEmpty: true }),
    opensAt: date,
    closesAt: date,
    maxChoices: z.number().int().min(1).max(MAX_CHOICES),
    offerDays: z.number().int().min(1).max(60),
    formId: safeId,
    pactTemplateUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use an https:// link.")
      .optional()
      .transform((v) => v || null),
    units: z
      .array(RecruitmentUnitInputSchema)
      .min(1, "Offer at least one unit.")
      .max(MAX_UNITS, `At most ${MAX_UNITS} units.`),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.closesAt <= r.opensAt) {
      ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Close after the opening." });
    }
    const ids = r.units.map((u) => u.orgUnitId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["units"], message: "Each unit once." });
    }
  });
export type RecruitmentInput = z.output<typeof RecruitmentInputSchema>;

export function isRecruitmentOpen(
  r: Pick<Recruitment, "published" | "opensAt" | "closesAt" | "deletedAt">,
  now: Date,
): boolean {
  return r.published && r.deletedAt === null && r.opensAt <= now && now < r.closesAt;
}

export function checkChoices(r: Pick<Recruitment, "maxChoices" | "units">, choices: unknown) {
  const parsed = z.array(safeId).safeParse(choices);
  if (!parsed.success || parsed.data.length === 0) {
    throw new RuleViolationError("Choose at least one unit.");
  }
  if (parsed.data.length > r.maxChoices) {
    throw new RuleViolationError(`Choose at most ${r.maxChoices} units.`);
  }
  if (new Set(parsed.data).size !== parsed.data.length) {
    throw new RuleViolationError("Choose each unit once.");
  }
  const offered = new Set(r.units.map((u) => u.orgUnitId));
  if (parsed.data.some((id) => !offered.has(id))) {
    throw new RuleViolationError("Choose from the units of this recruitment.");
  }
  return parsed.data;
}

export function portfolioRequired(r: Pick<Recruitment, "units">, choices: readonly string[]) {
  return r.units.some((u) => u.portfolioRequired && choices.includes(u.orgUnitId));
}

export function portfolioPath(recruitmentId: string, userId: string, now: Date, uuid: string) {
  return `recruitment/${recruitmentId}/${userId}/portfolio_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
}

export function formFilePath(formId: string, userId: string, now: Date, uuid: string) {
  return `forms/${formId}/${userId}_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
}

export function pactPath(recruitmentId: string, userId: string, now: Date, uuid: string) {
  return `recruitment/${recruitmentId}/${userId}/pact_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
}

export const revisionDocId = (applicationId: string, round: number) => `${applicationId}_${round}`;

export interface RevisionRound {
  readonly applicationId: string;
  readonly round: number;
  readonly request: string;
  readonly requestedAt: Date;
  readonly requestedBy: string;
  readonly resubmittedAt: Date | null;
}

export const RevisionRequestSchema = safeText(2000, { multiline: true });
export const PactNoteSchema = safeText(1000, { multiline: true });

export function makeOffer(
  r: Pick<Recruitment, "units" | "offerDays">,
  orgUnitId: string,
  now: Date,
): Offer {
  if (!r.units.some((u) => u.orgUnitId === orgUnitId)) {
    throw new RuleViolationError("Offer one of the units of this recruitment.");
  }
  return { orgUnitId, expiresAt: new Date(now.getTime() + r.offerDays * 86_400_000) };
}

export function takeSeat(counter: { quota: number; filled: number } | null): number {
  if (!counter || counter.filled >= counter.quota) {
    throw new RuleViolationError("All seats of this unit are taken.");
  }
  return counter.filled + 1;
}

export const offerExpired = (offer: Offer | null, now: Date) =>
  offer !== null && offer.expiresAt <= now;

export type NextAction =
  | "start"
  | "complete"
  | "revise"
  | "wait_review"
  | "interview"
  | "respond_offer"
  | "wait_approval"
  | "upload_pact"
  | "wait_ratification"
  | "welcome"
  | "closed"
  | "ended";

export function nextAction(
  r: Pick<Recruitment, "published" | "opensAt" | "closesAt" | "deletedAt">,
  application: Pick<Application, "status" | "offer"> | null,
  now: Date,
): NextAction {
  const open = isRecruitmentOpen(r, now);
  if (application === null) return open ? "start" : "closed";
  switch (application.status) {
    case "draft":
      return open ? "complete" : "closed";
    case "revision":
      return open ? "revise" : "closed";
    case "submitted":
      return "wait_review";
    case "interview":
      return "interview";
    case "offered":
      return offerExpired(application.offer, now) ? "ended" : "respond_offer";
    case "accepted":
      return "wait_approval";
    case "approved":
      return "upload_pact";
    case "pakta_review":
      return "wait_ratification";
    case "confirmed":
      return "welcome";
    default:
      return "ended";
  }
}

export const ApplicationDraftSchema = z
  .object({
    choices: z.array(safeId).max(MAX_CHOICES),
    answers: z.record(z.string().max(40), z.unknown()),
  })
  .strict();

export interface InterviewSlot {
  readonly id: string;
  readonly recruitmentId: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly capacity: number;
  readonly booked: number;
  readonly location: string;
  readonly deletedAt: Date | null;
}

export const MAX_SLOTS_PER_PLAN = 100;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const SlotPlanSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a day."),
    timeZone: TimezoneSchema,
    startTime: z.string().regex(HHMM, "Use HH:MM."),
    endTime: z.string().regex(HHMM, "Use HH:MM."),
    durationMinutes: z.number().int().min(5).max(240),
    gapMinutes: z.number().int().min(0).max(120),
    breaks: z
      .array(
        z
          .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
          .strict()
          .refine((b) => minutesOf(b.end) > minutesOf(b.start), "A break ends after it starts."),
      )
      .max(10),
    capacity: z.number().int().min(1).max(50),
    location: safeText(500, { allowEmpty: true }),
  })
  .strict()
  .refine((p) => minutesOf(p.endTime) > minutesOf(p.startTime), {
    path: ["endTime"],
    message: "End after the start.",
  });
export type SlotPlan = z.output<typeof SlotPlanSchema>;

export function slotTimes(plan: SlotPlan): Date[] {
  const end = minutesOf(plan.endTime);
  const breaks = plan.breaks.map((b) => [minutesOf(b.start), minutesOf(b.end)] as const);
  const times: Date[] = [];
  for (let at = minutesOf(plan.startTime); at + plan.durationMinutes <= end;) {
    const until = at + plan.durationMinutes;
    const overlap = breaks.find(([s, e]) => at < e && until > s);
    if (overlap) {
      at = overlap[1];
      continue;
    }
    const hh = String(Math.floor(at / 60)).padStart(2, "0");
    const mm = String(at % 60).padStart(2, "0");
    times.push(wallTimeToUtc(`${plan.date}T${hh}:${mm}`, plan.timeZone) as Date);
    at = until + plan.gapMinutes;
  }
  if (times.length > MAX_SLOTS_PER_PLAN) {
    throw new RuleViolationError(`At most ${MAX_SLOTS_PER_PLAN} slots at once.`);
  }
  return times;
}

export function canBook(slot: InterviewSlot, now: Date): boolean {
  return slot.deletedAt === null && slot.startsAt > now && slot.booked < slot.capacity;
}

export function assertBookable(slot: InterviewSlot | null, now: Date): InterviewSlot {
  if (!slot || slot.deletedAt !== null || slot.startsAt <= now) {
    throw new RuleViolationError("This interview time is no longer available.");
  }
  if (slot.booked >= slot.capacity) throw new RuleViolationError("This interview time is full.");
  return slot;
}
export * from "./personality";
