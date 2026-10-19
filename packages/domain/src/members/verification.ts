import { RuleViolationError } from "../shared";
import type { MemberProfile } from "./profile";

/**
 * Guarded fields (PPIDK DECISIONS §63): what is printed on letters and certificates or decides
 * membership. Before verification the member changes them freely (audited, redacted); once
 * verified, a change is a request a verifier approves. Other fields always apply at once.
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

/**
 * A member's own save. Not verified yet: everything applies. Verified: free fields apply, the
 * guarded fields keep their verified values and their changes become `request` (null = none).
 */
export function splitOwnEdit(
  current: MemberProfile | null,
  next: MemberProfile,
): { profile: MemberProfile; request: GuardedChanges | null } {
  const changes = guardedChanges(current, next);
  if (current?.verification.status !== "verified") return { profile: next, request: null };
  const kept = Object.fromEntries(GUARDED_PROFILE_FIELDS.map((f) => [f, current[f]]));
  return {
    profile: { ...next, ...kept },
    request: Object.keys(changes).length > 0 ? changes : null,
  };
}

/** Applies an approved request (`to` values) to the profile. */
export function applyChanges(profile: MemberProfile, changes: GuardedChanges): MemberProfile {
  const values = Object.fromEntries(Object.entries(changes).map(([field, c]) => [field, c.to]));
  return { ...profile, ...values };
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
 * Cancelling gives rights back, so it is not symmetric with marking (§67): a verifier may, and
 * the member only when they marked it themselves (same as never having marked it).
 */
export function canCancelGraduation(
  profile: Pick<MemberProfile, "userId" | "graduation">,
  actorId: string,
  isVerifier: boolean,
): boolean {
  return isVerifier || (actorId === profile.userId && profile.graduation.markedBy === actorId);
}
