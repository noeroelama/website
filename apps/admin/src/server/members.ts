import "server-only";
import { z } from "zod";
import type { FirestoreMemberProfileStore, ProfileAudit } from "@website/db/firestore";
import { checkGraduationDate } from "@website/domain/members";
import { RuleViolationError } from "@website/domain/shared";
import type { Principal } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface MemberDeps {
  readonly profiles: Pick<
    FirestoreMemberProfileStore,
    "findByUserId" | "verify" | "decide" | "setGraduation"
  >;
  readonly now: () => Date;
}

const NOT_YOURSELF = "Nobody verifies or decides changes of their own data. Ask another verifier.";
const Ref = { uid: safeId, version: z.number().int().min(1) };

const profileAudit =
  (audit: AuditBuilder): ProfileAudit =>
  (input) =>
    audit({ ...input, module: "members", resourceType: "profile", revertible: false });

/**
 * Members page (B4, B5): verify a profile, decide a change of verified data, mark or cancel
 * graduation. `members.verify` is checked against the MEMBER'S chapter, read on the server
 * (PPIDK §73: a chapter verifier never reaches another chapter's members).
 */
export function createMemberActions(deps: MemberDeps) {
  const chapterOf = async ({ uid }: { uid: string }) => {
    const profile = await deps.profiles.findByUserId(uid);
    return profile?.chapterId ? { chapterId: profile.chapterId } : {};
  };
  const notSelf = (principal: Principal, uid: string) => {
    if (principal.userId === uid) throw new RuleViolationError(NOT_YOURSELF);
  };

  const verify = createGuardedAction({
    permission: "members.verify",
    input: z.object(Ref).strict(),
    resource: chapterOf,
    handler: async ({ uid, version }, principal, audit) => {
      notSelf(principal, uid);
      const saved = await deps.profiles.verify(
        uid,
        version,
        principal.userId,
        profileAudit(audit),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const decide = createGuardedAction({
    permission: "members.verify",
    input: z
      .object({ ...Ref, approve: z.boolean(), note: safeText(500, { allowEmpty: true }) })
      .strict(),
    resource: chapterOf,
    handler: async ({ uid, version, approve, note }, principal, audit) => {
      notSelf(principal, uid);
      const saved = await deps.profiles.decide(
        uid,
        version,
        { approve, note: note || null },
        principal.userId,
        profileAudit(audit),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  /** Mark (date) or cancel (null, with a reason) a member's graduation. */
  const setGraduation = createGuardedAction({
    permission: "members.verify",
    input: z
      .object({
        ...Ref,
        graduatedOn: z.iso.date().nullable(),
        reason: safeText(500, { allowEmpty: true }),
      })
      .strict(),
    resource: chapterOf,
    handler: async ({ uid, version, graduatedOn, reason }, principal, audit) => {
      const now = deps.now();
      const saved = await deps.profiles.setGraduation(
        uid,
        version,
        { on: graduatedOn, markedBy: graduatedOn ? principal.userId : null, reason },
        (current) => {
          if (graduatedOn) return checkGraduationDate(graduatedOn, current, now);
          // A verifier of the member's chapter may cancel any mark, with a reason (§67).
          if (!reason) throw new RuleViolationError("Give the reason for cancelling.");
        },
        now,
        profileAudit(audit),
      );
      return { version: saved.version };
    },
  });

  return { verify, decide, setGraduation };
}
