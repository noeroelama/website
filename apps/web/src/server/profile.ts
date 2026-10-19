import "server-only";
import { z } from "zod";
import type { FirestoreMemberProfileStore, FirestoreUniversityStore } from "@website/db/firestore";
import {
  canCancelGraduation,
  checkGraduationDate,
  memberProfileInputSchema,
  ownProfile,
  PRIVACY_POLICY_VERSION,
  splitOwnEdit,
  type MemberProfile,
  type MemberProfileRepository,
} from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";

export interface ProfileDeps {
  readonly profiles: MemberProfileRepository & Pick<FirestoreMemberProfileStore, "setGraduation">;
  /** The picked campus is checked and its name used (A3). */
  readonly universities: Pick<FirestoreUniversityStore, "get">;
  readonly now: () => Date;
}

/** Who is signed in (from the verified session cookie; never from the form). */
export interface ProfileOwner {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export type ProfileSaveResult =
  /** pendingReview: changes of verified data wait for a verifier (the rest applied). */
  | { ok: true; version: number; pendingReview: boolean }
  | {
      ok: false;
      error: "signin" | "verify" | "invalid" | "consent" | "conflict" | "pending";
      /** invalid: first message per field (top-level name, e.g. "addressIndonesia"). */
      fields?: Record<string, string>;
    };

const Envelope = z
  .object({ version: z.number().int().min(1).nullable(), profile: z.unknown() })
  .strict();

/**
 * The member's own profile (/account/profile, profile.read_own / profile.write_own): always keyed
 * by the session's uid, so nobody reads or writes another member's profile from the website.
 * Saving needs a verified e-mail (it is copied into the profile).
 */
export function createOwnProfile(deps: ProfileDeps) {
  return {
    load: (owner: ProfileOwner | null): Promise<MemberProfile | null> =>
      owner ? deps.profiles.findByUserId(owner.uid) : Promise.resolve(null),

    async save(owner: ProfileOwner | null, raw: unknown): Promise<ProfileSaveResult> {
      if (!owner) return { ok: false, error: "signin" };
      if (!owner.emailVerified || !owner.email) return { ok: false, error: "verify" };
      const now = deps.now();
      const envelope = Envelope.safeParse(raw);
      const parsed = memberProfileInputSchema(now).safeParse(envelope.data?.profile);
      if (!envelope.success || !parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error?.issues ?? []) {
          const field = issue.path[0];
          if (typeof field === "string") fields[field] ??= issue.message;
        }
        return { ok: false, error: "invalid", fields };
      }
      // A picked campus must be approved (or the member's own proposal) in the PPI country.
      const { universityId } = parsed.data;
      const campus = universityId ? await deps.universities.get(universityId) : null;
      const usable =
        campus !== null &&
        campus.countryCode === parsed.data.ppiCountry &&
        (campus.status === "approved" ||
          (campus.status === "pending" && campus.submittedBy === owner.uid));
      if (universityId && !usable) {
        return {
          ok: false,
          error: "invalid",
          fields: { universityId: "Choose your campus from the list of your PPI country." },
        };
      }
      if (parsed.data.consent.privacyPolicyVersion !== PRIVACY_POLICY_VERSION) {
        return { ok: false, error: "consent" };
      }
      try {
        const current = await deps.profiles.findByUserId(owner.uid);
        // Verified data (name, birth date, chapter, campus …) changes only after review (§63).
        const { profile, request } = splitOwnEdit(
          current,
          ownProfile(
            { ...parsed.data, university: campus?.name ?? parsed.data.university },
            { userId: owner.uid, email: owner.email },
            current,
            now,
          ),
        );
        const saved = await deps.profiles.save(profile, envelope.data.version, request);
        return { ok: true, version: saved.version, pendingReview: request !== null };
      } catch (error) {
        if (error instanceof ConcurrencyConflictError) return { ok: false, error: "conflict" };
        if (error instanceof RuleViolationError) return { ok: false, error: "pending" };
        throw error;
      }
    },

    /**
     * Graduation (B5): the member marks or corrects their own date at once (it gives rights
     * up); cancelling only a mark they set themselves (§67). Errors: a message for the member.
     */
    async setGraduation(
      owner: ProfileOwner | null,
      raw: unknown,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      const input = z
        .object({ version: z.number().int().min(1), graduatedOn: z.iso.date().nullable() })
        .strict()
        .safeParse(raw);
      if (!owner || !input.success) return { ok: false, message: "invalid" };
      const now = deps.now();
      const { version, graduatedOn } = input.data;
      try {
        await deps.profiles.setGraduation(
          owner.uid,
          version,
          { on: graduatedOn, markedBy: graduatedOn ? owner.uid : null },
          (current) => {
            if (graduatedOn) checkGraduationDate(graduatedOn, current, now);
            else if (!canCancelGraduation(current, owner.uid, false)) {
              throw new RuleViolationError(
                "This graduation was marked by an officer; ask the secretariat to cancel it.",
              );
            }
          },
          now,
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof RuleViolationError) return { ok: false, message: error.message };
        if (error instanceof ConcurrencyConflictError) return { ok: false, message: "conflict" };
        throw error;
      }
    },
  };
}
