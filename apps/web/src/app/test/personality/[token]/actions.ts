"use server";

import { personalityTest } from "@/server/recruitment-wiring";

export async function submitPersonalityAction(input: unknown) {
  return personalityTest().submit(input);
}
