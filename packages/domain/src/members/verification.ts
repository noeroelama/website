import { RuleViolationError } from "../shared";
import type { MemberProfile } from "./profile";

/**
 * Guarded fields (PPIDK DECISIONS §63): what is printed on letters and certificates or decides
 * membership. The member changes them at once (there is no verification step); every change of
 * these fields is audited with restricted values redacted. Other fields are not audited.
 */
export const GUARDED_PROFILE_FIELDS = [
  "fullName",
  "gender",
  "dateOfBirth",
  "ppiCountry",
  "university",
  "universityId",
] as const;
export type GuardedProfileField = (typeof GUARDED_PROFILE_FIELDS)[number];

/** Old and new value of each guarded field that changes. */
export type GuardedChanges = Partial<
  Record<GuardedProfileField, { readonly from: unknown; readonly to: unknown }>
>;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function guardedChanges(before: MemberProfile | null, after: MemberProfile): GuardedChanges {
  const changes: GuardedChanges = {};
  for (const field of GUARDED_PROFILE_FIELDS) {
    if (!same(before?.[field], after[field])) {
      changes[field] = { from: before?.[field] ?? null, to: after[field] ?? null };
    }
  }
  return changes;
}

/* ---- Graduation (B5, PPIDK §67) ---- */

export const STUDY_STATUSES = ["student", "graduating", "alumni"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

/** Computed, never stored: a graduation date in the future means "graduating soon". */
export function studyStatus(graduatedOn: string | null, today: string): StudyStatus {
  if (graduatedOn === null) return "student";
  return graduatedOn > today ? "graduating" : "alumni";
}

/** Refuses an impossible graduation date (before the year of entry, or > 10 years ahead). */
export function checkGraduationDate(
  date: string,
  profile: Pick<MemberProfile, "yearOfEntry">,
  now: Date,
): void {
  if (Number(date.slice(0, 4)) < profile.yearOfEntry) {
    throw new RuleViolationError(
      `The graduation date cannot be before the year of entry (${profile.yearOfEntry}).`,
    );
  }
  const limit = `${now.getUTCFullYear() + 10}${now.toISOString().slice(4, 10)}`;
  if (date > limit) {
    throw new RuleViolationError("The graduation date is too far in the future: check the year.");
  }
}

/**
 * Cancelling gives rights back, so it is not symmetric with marking (§67): the member may cancel
 * only a mark they set themselves (same as never having marked it), not one an officer set.
 */
export function canCancelGraduation(
  profile: Pick<MemberProfile, "userId" | "graduation">,
  actorId: string,
): boolean {
  return actorId === profile.userId && profile.graduation.markedBy === actorId;
}
