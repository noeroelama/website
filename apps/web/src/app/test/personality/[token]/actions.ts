"use server";

import { personalityTest } from "@/server/recruitment-wiring";

// Thin wrapper: the signed link names the applicant; scoring in src/server/personality.ts.
export async function submitPersonalityAction(input: unknown) {
  return personalityTest().submit(input);
}
