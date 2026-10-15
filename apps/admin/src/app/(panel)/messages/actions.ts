"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { messageActions } from "@/server/wiring";

// Thin wrapper: rules in src/server/messaging.ts (createGuardedAction, messages.edit).
export async function retryMessageAction(input: unknown) {
  const result = await messageActions().retry(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/messages");
  return result;
}
