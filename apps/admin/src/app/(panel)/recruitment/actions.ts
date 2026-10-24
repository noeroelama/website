"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { applicationActions, recruitmentActions } from "@/server/wiring";

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

/* ---- selection queue (src/server/applications.ts) ---- */

const queued = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/recruitment", "layout");
  return result;
};

export async function requestRevisionAction(input: unknown) {
  return queued(await applicationActions().requestRevision(getPrincipal, getAuditContext)(input));
}

export async function failApplicationAction(input: unknown) {
  return queued(await applicationActions().fail(getPrincipal, getAuditContext)(input));
}

export async function passApplicationAction(input: unknown) {
  return queued(await applicationActions().pass(getPrincipal, getAuditContext)(input));
}

export async function rejectApplicationAction(input: unknown) {
  return queued(await applicationActions().reject(getPrincipal, getAuditContext)(input));
}

export async function offerApplicationAction(input: unknown) {
  return queued(await applicationActions().offer(getPrincipal, getAuditContext)(input));
}

/** A 15-minute link to a portfolio or file answer of the application. */
export async function applicationFileUrlAction(input: unknown) {
  return applicationActions().fileUrl(getPrincipal, getAuditContext)(input);
}
