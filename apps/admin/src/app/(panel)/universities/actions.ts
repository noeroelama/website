"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { universityActions } from "@/server/wiring";

// Thin server-action wrapper: every rule lives in src/server/universities.ts (createGuardedAction).
export async function reviewUniversityAction(input: unknown) {
  const result = await universityActions().review(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/universities");
  return result;
}
