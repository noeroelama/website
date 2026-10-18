import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  normalizeUniversityName,
  tidyUniversityName,
  type University,
  type UniversityProposal,
} from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { toDate } from "./slugged";

function toUniversity(id: string, data: Record<string, unknown>): University {
  return {
    ...(data as Omit<University, "id" | "reviewedAt" | "createdAt" | "updatedAt" | "deletedAt">),
    id,
    reviewedAt: toDate(data["reviewedAt"]),
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

const reviewSnapshot = (u: University): Snapshot => ({
  name: u.name,
  status: u.status,
  mergedInto: u.mergedInto,
  reviewNote: u.reviewNote,
});

/** What staff decide about a proposed campus. */
export type UniversityDecision =
  | { readonly type: "approve" }
  | { readonly type: "merge"; readonly into: string }
  | { readonly type: "reject"; readonly note: string };

/** At most this many member profiles follow one merge or reject (one transaction). */
const PROFILE_LIMIT = 400;

/**
 * `universities/{id}`: ROR rows (`{rorKey}_{countryCode}`, written by
 * infrastructure/scripts/import-ror-universities.mjs) and member proposals (random id, pending).
 * Profiles point at a campus with `memberProfiles/{uid}.universityId`.
 */
export function createFirestoreUniversityStore(db: Firestore) {
  const docs = db.collection("universities");
  const profiles = db.collection("memberProfiles");
  const auditLog = createFirestoreAuditWriter(db);
  const read = (id: string, data: unknown) => toUniversity(id, data as Record<string, unknown>);
  const byName = (a: University, b: University) => a.name.localeCompare(b.name);

  return {
    async get(id: string): Promise<University | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await docs.doc(id).get();
      return snapshot.exists ? read(id, snapshot.data()) : null;
    },

    /** The campuses members can pick in one country, by name. */
    async listApproved(countryCode: string): Promise<University[]> {
      const snapshot = await docs
        .where("countryCode", "==", countryCode)
        .where("status", "==", "approved")
        .get();
      return snapshot.docs.map((doc) => read(doc.id, doc.data())).sort(byName);
    },

    /** One member's proposals that are still waiting for review. */
    async listOwnPending(userId: string): Promise<University[]> {
      const snapshot = await docs
        .where("submittedBy", "==", userId)
        .where("status", "==", "pending")
        .get();
      return snapshot.docs.map((doc) => read(doc.id, doc.data())).sort(byName);
    },

    /** The review queue, oldest first. */
    async listPending(): Promise<University[]> {
      const snapshot = await docs.where("status", "==", "pending").get();
      return snapshot.docs
        .map((doc) => read(doc.id, doc.data()))
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    },

    /**
     * "My campus is not listed": a pending campus, unless an obvious duplicate exists in the same
     * country (same normalised name, approved or pending, or an alias of an approved campus).
     */
    propose(userId: string, proposal: UniversityProposal, now: Date): Promise<University> {
      const name = tidyUniversityName(proposal.name);
      const normalizedName = normalizeUniversityName(name);
      const ref = docs.doc(randomUUID());
      return db.runTransaction(async (tx) => {
        const [sameName, sameAlias] = await Promise.all([
          tx.get(
            docs
              .where("countryCode", "==", proposal.countryCode)
              .where("normalizedName", "==", normalizedName),
          ),
          tx.get(
            docs
              .where("countryCode", "==", proposal.countryCode)
              .where("aliasesNormalized", "array-contains", normalizedName),
          ),
        ]);
        const existing = [...sameName.docs, ...sameAlias.docs]
          .map((doc) => read(doc.id, doc.data()))
          .filter((u) => u.status !== "rejected")
          .sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved"))[0];
        if (existing) {
          throw new RuleViolationError(
            existing.status === "approved"
              ? `This campus is already listed as "${existing.name}". Choose it from the list.`
              : "This campus was already proposed and is waiting for review.",
          );
        }
        const fields: Omit<University, "id"> = {
          name,
          normalizedName,
          countryCode: proposal.countryCode,
          city: proposal.city || null,
          website: null,
          aliases: [],
          aliasesNormalized: [],
          rorId: null,
          source: "manual",
          status: "pending",
          submittedBy: userId,
          mergedInto: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        tx.set(ref, fields);
        return { id: ref.id, ...fields };
      });
    },

    /**
     * Decides a pending proposal in ONE transaction with its audit entry. Merge: the proposal is
     * rejected with `mergedInto` (kept as history, never deleted) and every profile pointing at it
     * moves to the approved campus. Reject: those profiles lose the pick and choose again.
     */
    review(
      id: string,
      expectedVersion: number,
      decision: UniversityDecision,
      reviewerId: string,
      audit: (
        before: Snapshot,
        after: Snapshot,
        current: University,
        next: University,
      ) => AuditEvent,
      now: Date,
    ): Promise<University> {
      const ref = docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This item does not exist.");
        const current = read(id, snapshot.data());
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("universities version changed");
        }
        if (current.status !== "pending") {
          throw new RuleViolationError("This proposal was already decided.");
        }
        let target: University | null = null;
        if (decision.type === "merge") {
          const targetSnapshot = await tx.get(docs.doc(safeId.parse(decision.into)));
          target = targetSnapshot.exists ? read(decision.into, targetSnapshot.data()) : null;
          if (target?.status !== "approved" || target.countryCode !== current.countryCode) {
            throw new RuleViolationError("Merge into an approved campus of the same country.");
          }
        }
        const pointing =
          decision.type === "approve"
            ? null
            : await tx.get(profiles.where("universityId", "==", id).limit(PROFILE_LIMIT + 1));
        if (pointing && pointing.size > PROFILE_LIMIT) {
          throw new RuleViolationError(`At most ${PROFILE_LIMIT} profiles can move at once.`);
        }
        const next: University = {
          ...current,
          status: decision.type === "approve" ? "approved" : "rejected",
          mergedInto: target?.id ?? null,
          reviewedBy: reviewerId,
          reviewedAt: now,
          reviewNote: decision.type === "reject" ? decision.note : null,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await auditLog.begin(tx);
        tx.update(ref, {
          status: next.status,
          mergedInto: next.mergedInto,
          reviewedBy: reviewerId,
          reviewedAt: now,
          reviewNote: next.reviewNote,
          version: next.version,
          updatedAt: now,
        });
        for (const doc of pointing?.docs ?? []) {
          tx.update(
            profiles.doc(doc.id),
            target ? { universityId: target.id, university: target.name } : { universityId: null },
          );
        }
        log.append(audit(reviewSnapshot(current), reviewSnapshot(next), current, next));
        return next;
      });
    },
  };
}

export type FirestoreUniversityStore = ReturnType<typeof createFirestoreUniversityStore>;
