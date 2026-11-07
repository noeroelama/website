"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { incomingActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/incoming.ts (createGuardedAction).
const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/letters");
  return result;
};

export async function recordIncomingAction(input: unknown) {
  return done(await incomingActions().record(getPrincipal, getAuditContext)(input));
}
export async function updateIncomingAction(input: unknown) {
  return done(await incomingActions().update(getPrincipal, getAuditContext)(input));
}
export async function disposeIncomingAction(input: unknown) {
  return done(await incomingActions().dispose(getPrincipal, getAuditContext)(input));
}
export async function completeDispositionAction(input: unknown) {
  return done(await incomingActions().complete(getPrincipal, getAuditContext)(input));
}
export async function archiveIncomingAction(input: unknown) {
  return done(await incomingActions().archive(getPrincipal, getAuditContext)(input));
}
