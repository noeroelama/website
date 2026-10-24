import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import type { Answers, FileAnswer } from "../forms";
import { RuleViolationError, type EntityMeta } from "../shared";

/**
 * Open recruitment (Oprec, feature C3). A recruitment belongs to a board period, offers seats in
 * org units (quota per unit, kept in `seatCounters/{recruitmentId}_{orgUnitId}`), asks the
 * questions of one frozen form version and takes one application per person
 * (`applications/{recruitmentId}_{uid}`). Docs: packages/domain/docs/recruitment.md.
 */

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

/**
 * Who may move an application where (feature-spec C3). `applicant` moves are made on the
 * website by the owner; the others are admin actions with their own permission.
 */
export const TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["revision", "admin_rejected", "interview", "withdrawn"],
  revision: ["submitted", "withdrawn"],
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

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) {
    throw new RuleViolationError(`An application in "${from}" cannot move to "${to}".`);
  }
}

/** Ends of the road: nothing more happens to the application. */
export const isFinal = (status: ApplicationStatus) => TRANSITIONS[status].length === 0;

export const MAX_CHOICES = 5;
export const MAX_UNITS = 60;
export const MAX_PORTFOLIO_BYTES = 5 * 1024 * 1024;

export interface RecruitmentUnit {
  readonly orgUnitId: string;
  /** Unit name when the recruitment was saved (shown to applicants). */
  readonly name: string;
  /** Seats; the live count is `seatCounters/{recruitmentId}_{orgUnitId}`. */
  readonly quota: number;
  /** Applicants who choose this unit upload a portfolio (PDF). */
  readonly portfolioRequired: boolean;
}

export interface Recruitment extends EntityMeta {
  readonly periodId: string;
  readonly title: string;
  readonly description: string;
  readonly opensAt: Date;
  readonly closesAt: Date;
  /** How many ordered unit choices an applicant may make. */
  readonly maxChoices: number;
  readonly units: readonly RecruitmentUnit[];
  /** An offer expires this many days after it is made. */
  readonly offerDays: number;
  /** The recruitment form and the version applicants answer (frozen once answered). */
  readonly formId: string;
  readonly formVersion: number;
  readonly published: boolean;
}

export interface Offer {
  readonly orgUnitId: string;
  readonly expiresAt: Date;
}

export interface Application {
  /** `{recruitmentId}_{userId}`: one per person per recruitment. */
  readonly id: string;
  readonly recruitmentId: string;
  readonly userId: string;
  readonly status: ApplicationStatus;
  /** Ordered org unit ids (first = most wanted). */
  readonly choices: readonly string[];
  readonly answers: Answers;
  /** Private PDF, when a chosen unit requires one. */
  readonly portfolio: FileAnswer | null;
  readonly revisionRound: number;
  readonly offer: Offer | null;
  readonly submittedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const applicationId = (recruitmentId: string, userId: string) =>
  `${recruitmentId}_${userId}`;
export const seatCounterId = (recruitmentId: string, orgUnitId: string) =>
  `${recruitmentId}_${orgUnitId}`;

/* ---------------------------------------------------------------- set-up (admin) */

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

/** Open for applications: published and inside its window (`closesAt` excluded). */
export function isRecruitmentOpen(
  r: Pick<Recruitment, "published" | "opensAt" | "closesAt" | "deletedAt">,
  now: Date,
): boolean {
  return r.published && r.deletedAt === null && r.opensAt <= now && now < r.closesAt;
}

/* ---------------------------------------------------------------- applying (web) */

/** The applicant's choices: 1..maxChoices distinct units of this recruitment, in order. */
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

/** A portfolio is needed only when a chosen unit asks for one. */
export function portfolioRequired(r: Pick<Recruitment, "units">, choices: readonly string[]) {
  return r.units.some((u) => u.portfolioRequired && choices.includes(u.orgUnitId));
}

/** Storage path of an applicant's portfolio (private; never a public URL). */
export function portfolioPath(recruitmentId: string, userId: string, now: Date, uuid: string) {
  return `recruitment/${recruitmentId}/${userId}/portfolio_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
}

/** Storage path of a file question's answer (matches the forms FileAnswer path rule). */
export function formFilePath(formId: string, userId: string, now: Date, uuid: string) {
  return `forms/${formId}/${userId}_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
}

/** `%PDF-` at the start: the only format of portfolios and file answers. */
export const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

/** An offer counts until its expiry (read-time rule: no job releases it). */
export const offerExpired = (offer: Offer | null, now: Date) =>
  offer !== null && offer.expiresAt <= now;

/**
 * The ONE thing the applicant should do (or wait for) now, shown on the application page.
 */
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

/** What the applicant edits before submitting (answers are checked against the form version). */
export const ApplicationDraftSchema = z
  .object({
    choices: z.array(safeId).max(MAX_CHOICES),
    answers: z.record(z.string().max(40), z.unknown()),
  })
  .strict();
