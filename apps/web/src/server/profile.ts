import "server-only";
import { z } from "zod";
import type { SqlMemberProfileStore, SqlUniversityStore } from "@website/db/sql";
import {
  canCancelGraduation,
  checkGraduationDate,
  memberProfileInputSchema,
  ownProfile,
  PRIVACY_POLICY_VERSION,
  type MemberProfile,
  type MemberProfileRepository,
} from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";

export interface ProfileDeps {
  readonly profiles: MemberProfileRepository & Pick<SqlMemberProfileStore, "setGraduation">;
  readonly universities: Pick<SqlUniversityStore, "get">;
  readonly now: () => Date;
}

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
      fields?: Record<string, string>;
    };

const Envelope = z
  .object({ version: z.number().int().min(1).nullable(), profile: z.unknown() })
  .strict();

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
        throw error;
      }
    },

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
            else if (!canCancelGraduation(current, owner.uid)) {
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
