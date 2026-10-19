import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  applyChanges,
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

/** Stored flat; the domain shape nests consent, verification and graduation. */
function toProfile(data: Record<string, unknown>): MemberProfile {
  const {
    privacyPolicyVersion,
    consentedAt,
    verificationStatus,
    verifiedBy,
    verifiedAt,
    graduatedOn,
    graduationMarkedBy,
    chapterId,
    createdAt,
    updatedAt,
    deletedAt,
    ...fields
  } = data;
  return {
    ...(fields as Omit<
      MemberProfile,
      | "consent"
      | "verification"
      | "graduation"
      | "chapterId"
      | "createdAt"
      | "updatedAt"
      | "deletedAt"
    >),
    chapterId: (chapterId as string | null | undefined) ?? null,
    consent: {
      privacyPolicyVersion: privacyPolicyVersion as string,
      consentedAt: toDate(consentedAt) as Date,
    },
    verification: {
      status: verificationStatus === "verified" ? "verified" : "unverified",
      verifiedBy: (verifiedBy as string | null | undefined) ?? null,
      verifiedAt: toDate(verifiedAt),
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
  const { consent, verification, graduation, ...fields } = profile;
  return {
    ...fields,
    privacyPolicyVersion: consent.privacyPolicyVersion,
    consentedAt: consent.consentedAt,
    verificationStatus: verification.status,
    verifiedBy: verification.verifiedBy,
    verifiedAt: verification.verifiedAt,
    graduatedOn: graduation.on,
    graduationMarkedBy: graduation.markedBy,
  };
}

/** A pending (or decided) change of guarded fields: `profileChangeRequests/{uid}`, one per profile. */
export interface ProfileChangeRequest {
  readonly userId: string;
  readonly fullName: string;
  readonly chapterId: string | null;
  readonly changes: GuardedChanges;
  readonly status: "pending" | "approved" | "rejected";
  readonly createdAt: Date;
  readonly decidedBy: string | null;
  readonly note: string | null;
}

/** Audit entry for one staff decision on a profile (module `members`, never revertible). */
export type ProfileAudit = (input: {
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
 * on the website, or by staff with `members.verify` / `members.pii` for the member's chapter.
 * Saving also copies the member's chapter (the active chapter of `ppiCountry`) to the profile and
 * `users/{uid}.chapterId`, so chapter-scoped staff lists are one query (A2).
 */
export function createFirestoreMemberProfileStore(db: Firestore) {
  const profiles = db.collection("memberProfiles");
  const requests = db.collection("profileChangeRequests");
  const users = db.collection("users");
  const chapters = db.collection("chapters");
  const auditLog = createFirestoreAuditWriter(db);

  const chapterOf = async (tx: Transaction, countryCode: string) => {
    const found = await tx.get(
      chapters.where("countryCode", "==", countryCode).where("active", "==", true).limit(1),
    );
    return found.docs[0]?.id ?? null;
  };
  const read = async (tx: Transaction, uid: string) => {
    const snapshot = await tx.get(profiles.doc(safeId.parse(uid)));
    if (!snapshot.exists) throw new RuleViolationError("This profile does not exist.");
    return toProfile(snapshot.data() as Record<string, unknown>);
  };
  const scoped = (chapterIds: "all" | readonly string[]) => {
    if (chapterIds === "all") return null;
    if (chapterIds.length === 0) return [];
    if (chapterIds.length > 30) throw new Error("A list can filter by at most 30 chapters.");
    return [...chapterIds];
  };
  /** One staff change of a profile: version check, write, audit — in one transaction. */
  const change = (
    uid: string,
    expectedVersion: number,
    build: (current: MemberProfile, tx: Transaction) => Promise<MemberProfile>,
    audit: ProfileAudit,
    describe: (
      current: MemberProfile,
      next: MemberProfile,
    ) => { before: Snapshot; after: Snapshot },
    now: Date,
    alsoWrite: (tx: Transaction, next: MemberProfile) => void = () => undefined,
  ) =>
    db.runTransaction(async (tx) => {
      const current = await read(tx, uid);
      if (current.version !== expectedVersion) {
        throw new ConcurrencyConflictError("memberProfiles version changed");
      }
      const built = await build(current, tx);
      const next = { ...built, version: current.version + 1, updatedAt: now };
      const log = await auditLog.begin(tx);
      tx.set(profiles.doc(uid), toDoc(next));
      alsoWrite(tx, next);
      log.append(
        audit({
          action: "UPDATE",
          title: current.fullName,
          resourceId: uid,
          ...describe(current, next),
          versionBefore: current.version,
          versionAfter: next.version,
        }),
      );
      return next;
    });

  const repository: MemberProfileRepository = {
    async findByUserId(userId) {
      if (!safeId.safeParse(userId).success) return null;
      const snapshot = await profiles.doc(userId).get();
      return snapshot.exists ? toProfile(snapshot.data() as Record<string, unknown>) : null;
    },

    /**
     * The member's own save. Guarded fields changed before verification are audited (actor the
     * member, values redacted); after verification they arrive as `request` (one pending at most).
     */
    save(profile, expectedVersion, request = null) {
      const ref = profiles.doc(safeId.parse(profile.userId));
      const userRef = users.doc(profile.userId);
      return db.runTransaction(async (tx) => {
        const [stored, chapterId, pending] = await Promise.all([
          tx.get(ref),
          chapterOf(tx, profile.ppiCountry),
          request ? tx.get(requests.doc(profile.userId)) : null,
        ]);
        const before = stored.exists ? toProfile(stored.data() as Record<string, unknown>) : null;
        if ((before?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("memberProfiles version changed");
        }
        if (pending?.exists && pending.get("status") === "pending") {
          throw new RuleViolationError(
            "A change of your verified data is already waiting for review.",
          );
        }
        const next = { ...profile, chapterId };
        const direct = before && !request ? guardedChanges(before, next) : {};
        const log = Object.keys(direct).length > 0 ? await auditLog.begin(tx) : null;
        tx.set(ref, toDoc(next));
        // users/{uid} exists: the first sign-in created it before the member could get here.
        tx.update(userRef, { chapterId });
        if (request) {
          tx.set(requests.doc(profile.userId), {
            userId: profile.userId,
            fullName: before?.fullName ?? profile.fullName,
            chapterId,
            changes: request,
            status: "pending",
            createdAt: profile.updatedAt,
            decidedBy: null,
            note: null,
          });
        }
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

    /** Profiles waiting for verification, of these chapters ("all" = every chapter). */
    async listToVerify(chapterIds: "all" | readonly string[]): Promise<MemberProfile[]> {
      const ids = scoped(chapterIds);
      if (ids?.length === 0) return [];
      let query = profiles.where("verificationStatus", "==", "unverified");
      if (ids) query = query.where("chapterId", "in", ids);
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => toProfile(doc.data()));
    },

    /** Pending change requests of these chapters (§73: never another chapter's). */
    async listChangeRequests(
      chapterIds: "all" | readonly string[],
    ): Promise<ProfileChangeRequest[]> {
      const ids = scoped(chapterIds);
      if (ids?.length === 0) return [];
      let query = requests.where("status", "==", "pending");
      if (ids) query = query.where("chapterId", "in", ids);
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return { ...(data as ProfileChangeRequest), createdAt: toDate(data["createdAt"]) as Date };
      });
    },

    /** Verified: guarded fields now change only through requests; the account becomes a member. */
    verify(
      uid: string,
      expectedVersion: number,
      verifierId: string,
      audit: ProfileAudit,
      now: Date,
    ) {
      return change(
        uid,
        expectedVersion,
        (current) => {
          if (current.verification.status === "verified") {
            throw new RuleViolationError("This profile is already verified.");
          }
          return Promise.resolve({
            ...current,
            verification: { status: "verified", verifiedBy: verifierId, verifiedAt: now },
          });
        },
        audit,
        () => ({ before: { verification: "unverified" }, after: { verification: "verified" } }),
        now,
      );
    },

    /** Approve (the requested values apply) or reject a pending change request. */
    decide(
      uid: string,
      expectedVersion: number,
      decision: { approve: boolean; note: string | null },
      deciderId: string,
      audit: ProfileAudit,
      now: Date,
    ) {
      let pendingChanges: GuardedChanges = {};
      return change(
        uid,
        expectedVersion,
        async (current, tx) => {
          const request = await tx.get(requests.doc(uid));
          if (!request.exists || request.get("status") !== "pending") {
            throw new RuleViolationError("There is no change waiting for review.");
          }
          pendingChanges = request.get("changes") as GuardedChanges;
          if (!decision.approve) return current;
          const next = applyChanges(current, pendingChanges);
          return { ...next, chapterId: await chapterOf(tx, next.ppiCountry) };
        },
        audit,
        (current, next) =>
          decision.approve
            ? redacted(current, next, pendingChanges)
            : { before: { request: "pending" }, after: { request: "rejected" } },
        now,
        (tx, next) => {
          tx.update(requests.doc(uid), {
            status: decision.approve ? "approved" : "rejected",
            decidedBy: deciderId,
            decidedAt: now,
            note: decision.note,
          });
          tx.update(users.doc(uid), { chapterId: next.chapterId });
        },
      );
    },

    /**
     * Marks, corrects or cancels the graduation date; who marked it is kept (§67). Without
     * `audit` the change is the member's own (actor the member).
     */
    setGraduation(
      uid: string,
      expectedVersion: number,
      graduation: { on: string | null; markedBy: string | null; reason?: string },
      check: (current: MemberProfile) => void,
      now: Date,
      audit: ProfileAudit = memberAudit(uid, now),
    ) {
      return change(
        uid,
        expectedVersion,
        (current) => {
          check(current);
          return Promise.resolve({
            ...current,
            graduation: { on: graduation.on, markedBy: graduation.markedBy },
          });
        },
        audit,
        (current) => ({
          before: { graduatedOn: current.graduation.on },
          after: { graduatedOn: graduation.on, reason: graduation.reason ?? null },
        }),
        now,
      );
    },
  };
}

export type FirestoreMemberProfileStore = ReturnType<typeof createFirestoreMemberProfileStore>;
