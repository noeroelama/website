import "server-only";
import { z } from "zod";
import type { FirestoreUniversityStore } from "@website/db/firestore";
import {
  memberProfileInputSchema,
  ownProfile,
  type MemberProfile,
  type MemberProfileRepository,
} from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";

export interface ProfileDeps {
  readonly profiles: MemberProfileRepository;
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
  | { ok: true; version: number }
  | {
      ok: false;
      error: "signin" | "verify" | "invalid" | "consent" | "conflict";
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
      try {
        const current = await deps.profiles.findByUserId(owner.uid);
        const profile = ownProfile(
          { ...parsed.data, university: campus?.name ?? parsed.data.university },
          { userId: owner.uid, email: owner.email },
          current,
          now,
        );
        const saved = await deps.profiles.save(profile, envelope.data.version);
        return { ok: true, version: saved.version };
      } catch (error) {
        if (error instanceof ConcurrencyConflictError) return { ok: false, error: "conflict" };
        if (error instanceof RuleViolationError) return { ok: false, error: "consent" };
        throw error;
      }
    },
  };
}
