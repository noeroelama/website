"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { auditLogActions } from "@/server/wiring";

// Thin wrapper: rules in src/server/audit-log.ts (createGuardedAction, audit.revert).
export async function revertAction(input: unknown) {
  const result = await auditLogActions().revert(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/audit");
  return result;
}
