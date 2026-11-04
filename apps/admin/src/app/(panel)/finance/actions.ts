"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { financeActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/finance.ts (createGuardedAction).
const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/finance");
  return result;
};

export async function saveFinanceAction(input: unknown) {
  return done(await financeActions().save(getPrincipal, getAuditContext)(input));
}
export async function removeFinanceAction(input: unknown) {
  return done(await financeActions().remove(getPrincipal, getAuditContext)(input));
}
export async function submitFinanceAction(input: unknown) {
  return done(await financeActions().submit(getPrincipal, getAuditContext)(input));
}
export async function reviewFinanceAction(input: unknown) {
  return done(await financeActions().review(getPrincipal, getAuditContext)(input));
}
export async function authorizeFinanceAction(input: unknown) {
  return done(await financeActions().authorize(getPrincipal, getAuditContext)(input));
}
export async function returnFinanceAsTreasurerAction(input: unknown) {
  return done(await financeActions().returnAsTreasurer(getPrincipal, getAuditContext)(input));
}
export async function returnFinanceAsCoordinatorAction(input: unknown) {
  return done(await financeActions().returnAsCoordinator(getPrincipal, getAuditContext)(input));
}
export async function rejectFinanceAsTreasurerAction(input: unknown) {
  return done(await financeActions().rejectAsTreasurer(getPrincipal, getAuditContext)(input));
}
export async function rejectFinanceAsCoordinatorAction(input: unknown) {
  return done(await financeActions().rejectAsCoordinator(getPrincipal, getAuditContext)(input));
}
export async function completeFinanceAction(input: unknown) {
  return done(await financeActions().complete(getPrincipal, getAuditContext)(input));
}
export async function removeFinanceFileAction(input: unknown) {
  return done(await financeActions().removeFile(getPrincipal, getAuditContext)(input));
}
