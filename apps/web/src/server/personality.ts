import "server-only";
import { z } from "zod";
import type { SqlPersonalityStore, PersonalityResult } from "@website/db/sql";
import {
  PERSONALITY_LINK_DAYS,
  PersonalityAnswersSchema,
  personalityLinkData,
  personalityLinkUser,
  scorePersonality,
} from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { signLink, verifyLink } from "@website/security";

/**
 * The personality test (C5) at /test/personality/{token}. The token is a signed 7-day link
 * (LINK_SIGNING_SECRET, purpose "personality") that names the applicant, so the page needs no
 * sign-in; scoring happens here, and a result is stored once and never overwritten.
 */
export interface PersonalityDeps {
  readonly results: Pick<SqlPersonalityStore, "get" | "saveOnce">;
  readonly secret: string;
  readonly now: () => Date;
}

export type PersonalitySubmitResult =
  | { readonly ok: true; readonly result: PersonalityResult }
  | { readonly ok: false; readonly error: "link" | "invalid" | "taken" };

const Input = z.object({ token: z.string().max(2000), answers: z.unknown() }).strict();

export function createPersonalityTest(deps: PersonalityDeps) {
  // A valid signature means the body is ours (JSON), so verifyLink does not throw here.
  const userOf = (token: string) => personalityLinkUser(verifyLink(token, deps.secret, deps.now()));

  return {
    /** A new 7-day link for the applicant (shown on the application page). */
    linkFor: (uid: string) =>
      signLink(
        personalityLinkData(uid),
        deps.secret,
        new Date(deps.now().getTime() + PERSONALITY_LINK_DAYS * 86_400_000),
      ),

    /** The applicant of a valid link and their result (null = not taken yet); null for a bad link. */
    async open(token: string): Promise<{ uid: string; result: PersonalityResult | null } | null> {
      const uid = userOf(token);
      return uid ? { uid, result: await deps.results.get(uid) } : null;
    },

    async submit(input: unknown): Promise<PersonalitySubmitResult> {
      const parsed = Input.safeParse(input);
      const uid = parsed.success ? userOf(parsed.data.token) : null;
      if (!uid) return { ok: false, error: "link" };
      const answers = PersonalityAnswersSchema.safeParse(parsed.data?.answers);
      if (!answers.success) return { ok: false, error: "invalid" };
      try {
        return {
          ok: true,
          result: await deps.results.saveOnce(uid, scorePersonality(answers.data), deps.now()),
        };
      } catch (error) {
        if (error instanceof RuleViolationError) return { ok: false, error: "taken" };
        throw error;
      }
    },
  };
}
