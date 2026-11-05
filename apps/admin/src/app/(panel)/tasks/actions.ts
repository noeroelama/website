"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { tasks } from "@/server/wiring";

// Thin server-action wrapper: the rule lives in src/server/tasks.ts (createGuardedAction).
export async function shareBoardAction(input: unknown) {
  const result = await tasks().share(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/tasks", "layout");
  return result;
}
