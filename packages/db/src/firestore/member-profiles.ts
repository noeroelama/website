import type { Firestore } from "firebase-admin/firestore";
import type { MemberProfile, MemberProfileRepository } from "@website/domain/members";
import { ConcurrencyConflictError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { toDate } from "./slugged";

function toProfile(data: Record<string, unknown>): MemberProfile {
  const { privacyPolicyVersion, consentedAt, createdAt, updatedAt, deletedAt, ...fields } = data;
  return {
    ...(fields as Omit<MemberProfile, "consent" | "createdAt" | "updatedAt" | "deletedAt">),
    consent: {
      privacyPolicyVersion: privacyPolicyVersion as string,
      consentedAt: toDate(consentedAt) as Date,
    },
    createdAt: toDate(createdAt) as Date,
    updatedAt: toDate(updatedAt) as Date,
    deletedAt: toDate(deletedAt),
  };
}

/**
 * `memberProfiles/{uid}` (personal data, UU PDP): read and written only for the member's own uid
 * on the website, or by staff with `members.pii`. Saving also copies the member's chapter (the
 * active chapter of `ppiCountry`) to `users/{uid}.chapterId`, so chapter-scoped staff lists are
 * one query (A2). Personal data never goes into `users`.
 */
export function createFirestoreMemberProfileStore(db: Firestore): MemberProfileRepository {
  const profiles = db.collection("memberProfiles");
  const users = db.collection("users");
  const chapters = db.collection("chapters");

  return {
    async findByUserId(userId) {
      if (!safeId.safeParse(userId).success) return null;
      const snapshot = await profiles.doc(userId).get();
      return snapshot.exists ? toProfile(snapshot.data() as Record<string, unknown>) : null;
    },

    save(profile, expectedVersion) {
      const ref = profiles.doc(safeId.parse(profile.userId));
      const userRef = users.doc(profile.userId);
      return db.runTransaction(async (tx) => {
        const [stored, chapter] = await Promise.all([
          tx.get(ref),
          tx.get(
            chapters
              .where("countryCode", "==", profile.ppiCountry)
              .where("active", "==", true)
              .limit(1),
          ),
        ]);
        const version = stored.exists ? (stored.get("version") as number) : null;
        if (version !== expectedVersion) {
          throw new ConcurrencyConflictError("memberProfiles version changed");
        }
        const { consent, ...fields } = profile;
        tx.set(ref, {
          ...fields,
          privacyPolicyVersion: consent.privacyPolicyVersion,
          consentedAt: consent.consentedAt,
        });
        // users/{uid} exists: the first sign-in created it before the member could get here.
        tx.update(userRef, { chapterId: chapter.docs[0]?.id ?? null });
        return profile;
      });
    },
  };
}
