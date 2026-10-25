import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  guardedChanges,
  profileAuditSnapshots,
  type GuardedChanges,
  type MemberProfile,
  type MemberProfileRepository,
} from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { toDate } from "./slugged";

/**
 * Profile verification was removed (2026-10-24). Older documents still carry these fields; they
 * are left out when reading, so the next save (a full `set`) removes them.
 */
const REMOVED_FIELDS = new Set(["verificationStatus", "verifiedBy", "verifiedAt"]);

/** Stored flat; the domain shape nests consent and graduation. */
function toProfile(data: Record<string, unknown>): MemberProfile {
  const {
    privacyPolicyVersion,
    consentedAt,
    graduatedOn,
    graduationMarkedBy,
    chapterId,
    createdAt,
    updatedAt,
    deletedAt,
    ...stored
  } = data;
  const fields = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !REMOVED_FIELDS.has(key)),
  );
  return {
    ...(fields as Omit<
      MemberProfile,
      "consent" | "graduation" | "chapterId" | "createdAt" | "updatedAt" | "deletedAt"
    >),
    chapterId: (chapterId as string | null | undefined) ?? null,
    consent: {
      privacyPolicyVersion: privacyPolicyVersion as string,
      consentedAt: toDate(consentedAt) as Date,
    },
    graduation: {
      on: (graduatedOn as string | null | undefined) ?? null,
      markedBy: (graduationMarkedBy as string | null | undefined) ?? null,
    },
    createdAt: toDate(createdAt) as Date,
    updatedAt: toDate(updatedAt) as Date,
    deletedAt: toDate(deletedAt),
  };
}

function toDoc(profile: MemberProfile): Record<string, unknown> {
  const { consent, graduation, ...fields } = profile;
  return {
    ...fields,
    privacyPolicyVersion: consent.privacyPolicyVersion,
    consentedAt: consent.consentedAt,
    graduatedOn: graduation.on,
    graduationMarkedBy: graduation.markedBy,
  };
}

/** Audit entry for one change of a profile (module `members`, never revertible). */
type ProfileAudit = (input: {
  action: "UPDATE";
  title: string;
  resourceId: string;
  before: Snapshot | null;
  after: Snapshot | null;
  versionBefore: number;
  versionAfter: number;
}) => AuditEvent;

/** The entry for a member's own change (actor the member). */
const memberAudit =
  (uid: string, now: Date): ProfileAudit =>
  (input) => ({
    ...input,
    id: randomUUID(),
    occurredAt: now,
    actor: { type: "member", id: uid },
    module: "members",
    resourceType: "profile",
    operationId: randomUUID(),
    revertible: false,
    revertOf: null,
    request: { requestId: randomUUID() },
    prevHash: null,
    hash: null,
  });

/** Restricted values never reach the audit log (`profileAuditSnapshots`). */
const redacted = (before: MemberProfile, after: MemberProfile, changes: GuardedChanges) => {
  const pick = (p: MemberProfile) =>
    Object.fromEntries(
      Object.keys(changes).map((field) => [field, p[field as keyof MemberProfile]]),
    );
  // Profile values are plain JSON (strings, numbers, arrays, nested objects).
  const snapshots = profileAuditSnapshots(pick(before), pick(after));
  return { before: snapshots.before as Snapshot, after: snapshots.after as Snapshot };
};

/**
 * `memberProfiles/{uid}` (personal data, UU PDP): read and written only for the member's own uid
 * on the website, or read by staff with `members.pii` for the member's chapter.
 * Saving also copies the member's chapter (the active chapter of `ppiCountry`) to the profile and
 * `users/{uid}.chapterId`, so chapter-scoped staff lists are one query (A2).
 */
export function createFirestoreMemberProfileStore(db: Firestore) {
  const profiles = db.collection("memberProfiles");
  const users = db.collection("users");
  const chapters = db.collection("chapters");
  const auditLog = createFirestoreAuditWriter(db);

  const chapterOf = async (tx: Transaction, countryCode: string) => {
    const found = await tx.get(
      chapters.where("countryCode", "==", countryCode).where("active", "==", true).limit(1),
    );
    return found.docs[0]?.id ?? null;
  };

  const repository: MemberProfileRepository = {
    async findByUserId(userId) {
      if (!safeId.safeParse(userId).success) return null;
      const snapshot = await profiles.doc(userId).get();
      return snapshot.exists ? toProfile(snapshot.data() as Record<string, unknown>) : null;
    },

    /**
     * The member's own save; everything applies at once. Changes of the guarded fields (name,
     * gender, birth date, PPI country, campus) are audited (actor the member, values redacted).
     */
    save(profile, expectedVersion) {
      const ref = profiles.doc(safeId.parse(profile.userId));
      const userRef = users.doc(profile.userId);
      return db.runTransaction(async (tx) => {
        const [stored, chapterId] = await Promise.all([
          tx.get(ref),
          chapterOf(tx, profile.ppiCountry),
        ]);
        const before = stored.exists ? toProfile(stored.data() as Record<string, unknown>) : null;
        if ((before?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("memberProfiles version changed");
        }
        const next = { ...profile, chapterId };
        const direct = before ? guardedChanges(before, next) : {};
        const log = Object.keys(direct).length > 0 ? await auditLog.begin(tx) : null;
        tx.set(ref, toDoc(next));
        // users/{uid} exists: the first sign-in created it before the member could get here.
        tx.update(userRef, { chapterId });
        if (log && before) {
          const snapshots = redacted(before, next, direct);
          log.append(
            memberAudit(
              profile.userId,
              profile.updatedAt,
            )({
              action: "UPDATE",
              title: before.fullName,
              resourceId: profile.userId,
              before: snapshots.before,
              after: snapshots.after,
              versionBefore: before.version,
              versionAfter: next.version,
            }),
          );
        }
        return next;
      });
    },
  };

  return {
    ...repository,

    /**
     * The member marks, corrects or cancels their own graduation date; who marked it is kept
     * (§67). `check` refuses with fresh data (throw). Version check, write and audit in one
     * transaction.
     */
    setGraduation(
      uid: string,
      expectedVersion: number,
      graduation: { on: string | null; markedBy: string | null },
      check: (current: MemberProfile) => void,
      now: Date,
    ) {
      const ref = profiles.doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This profile does not exist.");
        const current = toProfile(snapshot.data() as Record<string, unknown>);
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("memberProfiles version changed");
        }
        check(current);
        const next: MemberProfile = {
          ...current,
          graduation: { on: graduation.on, markedBy: graduation.markedBy },
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, toDoc(next));
        log.append(
          memberAudit(
            uid,
            now,
          )({
            action: "UPDATE",
            title: current.fullName,
            resourceId: uid,
            before: { graduatedOn: current.graduation.on },
            after: { graduatedOn: graduation.on },
            versionBefore: current.version,
            versionAfter: next.version,
          }),
        );
        return next;
      });
    },
  };
}

export type FirestoreMemberProfileStore = ReturnType<typeof createFirestoreMemberProfileStore>;
