import "server-only";
import type { FirestoreUniversityStore } from "@website/db/firestore";
import { UniversityProposalSchema } from "@website/domain/members";
import { RuleViolationError } from "@website/domain/shared";
import type { ProfileOwner } from "./profile";

export interface UniversityPickerDeps {
  readonly universities: Pick<
    FirestoreUniversityStore,
    "listApproved" | "listOwnPending" | "propose"
  >;
  readonly now: () => Date;
}

/** One choice of the university picker; `pending` marks the member's own proposal. */
export interface UniversityChoice {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly pending: boolean;
}

export type ProposalResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: "signin" | "verify" | "invalid" }
  | { ok: false; error: "duplicate"; message: string };

/**
 * University picker on /account/profile (A3): the approved campuses of the chosen PPI country
 * (the browser filters them as the member types) plus the member's own pending proposals — never
 * anyone else's. "+" proposes a campus that is not listed.
 */
export function createUniversityPicker(deps: UniversityPickerDeps) {
  return {
    /** Approved campuses of one country (the same for everyone: cacheable). */
    async approved(countryCode: string): Promise<UniversityChoice[]> {
      const approved = await deps.universities.listApproved(countryCode);
      return approved.map((u) => ({ id: u.id, name: u.name, aliases: u.aliases, pending: false }));
    },

    /** The signed-in member's own proposals in that country that wait for review. */
    async ownPending(owner: ProfileOwner | null, countryCode: string): Promise<UniversityChoice[]> {
      if (!owner) return [];
      const mine = await deps.universities.listOwnPending(owner.uid);
      return mine
        .filter((u) => u.countryCode === countryCode)
        .map((u) => ({ id: u.id, name: u.name, aliases: u.aliases, pending: true }));
    },

    async propose(owner: ProfileOwner | null, raw: unknown): Promise<ProposalResult> {
      if (!owner) return { ok: false, error: "signin" };
      if (!owner.emailVerified) return { ok: false, error: "verify" };
      const parsed = UniversityProposalSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: "invalid" };
      try {
        const created = await deps.universities.propose(owner.uid, parsed.data, deps.now());
        return { ok: true, id: created.id, name: created.name };
      } catch (error) {
        if (error instanceof RuleViolationError) {
          return { ok: false, error: "duplicate", message: error.message };
        }
        throw error;
      }
    },
  };
}
