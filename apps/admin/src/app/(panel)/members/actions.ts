"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { memberActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/members.ts (createGuardedAction).
export async function verifyProfileAction(input: unknown) {
  const result = await memberActions().verify(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/members");
  return result;
}

export async function decideChangeAction(input: unknown) {
  const result = await memberActions().decide(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/members");
  return result;
}
