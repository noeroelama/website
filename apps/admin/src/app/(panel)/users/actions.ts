"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { accountActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/accounts.ts (createGuardedAction).
export async function assignRoleAction(input: unknown) {
  const result = await accountActions().assignRole(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/users", "layout");
  return result;
}

export async function revokeRoleAction(input: unknown) {
  const result = await accountActions().revokeRole(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/users", "layout");
  return result;
}

export async function setStatusAction(input: unknown) {
  const result = await accountActions().setStatus(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/users", "layout");
  return result;
}
