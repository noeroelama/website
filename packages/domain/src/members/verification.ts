import { RuleViolationError } from "../shared";
import type { MemberProfile } from "./profile";

export const GUARDED_PROFILE_FIELDS = [
  "fullName",
  "gender",
  "dateOfBirth",
  "ppiCountry",
  "university",
  "universityId",
] as const;
export type GuardedProfileField = (typeof GUARDED_PROFILE_FIELDS)[number];

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

export const STUDY_STATUSES = ["student", "graduating", "alumni"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export function studyStatus(graduatedOn: string | null, today: string): StudyStatus {
  if (graduatedOn === null) return "student";
  return graduatedOn > today ? "graduating" : "alumni";
}

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

export function canCancelGraduation(
  profile: Pick<MemberProfile, "userId" | "graduation">,
  actorId: string,
): boolean {
  return actorId === profile.userId && profile.graduation.markedBy === actorId;
}
