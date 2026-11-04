"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { okrActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/okr.ts (createGuardedAction).
const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/okr");
  return result;
};

export async function saveObjectiveAction(input: unknown) {
  return done(await okrActions().saveObjective(getPrincipal, getAuditContext)(input));
}
export async function removeObjectiveAction(input: unknown) {
  return done(await okrActions().removeObjective(getPrincipal, getAuditContext)(input));
}
export async function saveKeyResultAction(input: unknown) {
  return done(await okrActions().saveKeyResult(getPrincipal, getAuditContext)(input));
}
export async function deleteKeyResultAction(input: unknown) {
  return done(await okrActions().deleteKeyResult(getPrincipal, getAuditContext)(input));
}
export async function saveVisionAction(input: unknown) {
  return done(await okrActions().saveVision(getPrincipal, getAuditContext)(input));
}
