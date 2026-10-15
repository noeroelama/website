"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { roleActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/roles.ts (createGuardedAction).
export async function saveRoleAction(input: unknown) {
  const result = await roleActions().saveRole(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/roles", "layout");
  return result;
}

export async function deleteRoleAction(input: unknown) {
  const result = await roleActions().deleteRole(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/roles", "layout");
  return result;
}

export async function addSuggestedRolesAction() {
  const result = await roleActions().addSuggestedRoles(getPrincipal, getAuditContext)({});
  if (result.ok) revalidatePath("/roles", "layout");
  return result;
}
