"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { recruitmentActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/recruitment.ts (createGuardedAction).
export async function saveRecruitmentAction(input: unknown) {
  const result = await recruitmentActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}

export async function setRecruitmentPublishedAction(input: unknown) {
  const result = await recruitmentActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}

export async function removeRecruitmentAction(input: unknown) {
  const result = await recruitmentActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/recruitment");
  return result;
}
