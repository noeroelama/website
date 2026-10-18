"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { chapterActions, orgUnitActions, periodActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/{chapters,periods,org-units}.ts (createGuardedAction).
export async function saveChapterAction(input: unknown) {
  const result = await chapterActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function setChapterActiveAction(input: unknown) {
  const result = await chapterActions().setActive(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function savePeriodAction(input: unknown) {
  const result = await periodActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function activatePeriodAction(input: unknown) {
  const result = await periodActions().activate(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function saveOrgUnitAction(input: unknown) {
  const result = await orgUnitActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function moveOrgUnitAction(input: unknown) {
  const result = await orgUnitActions().move(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}
