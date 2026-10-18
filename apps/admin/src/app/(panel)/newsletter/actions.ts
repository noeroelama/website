"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { newsletterActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/newsletter.ts (createGuardedAction).
export async function saveCampaignAction(input: unknown) {
  const result = await newsletterActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/newsletter", "layout");
  return result;
}

export async function sendCampaignAction(input: unknown) {
  const result = await newsletterActions().send(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/newsletter", "layout");
  return result;
}

export async function removeCampaignAction(input: unknown) {
  const result = await newsletterActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/newsletter", "layout");
  return result;
}

export async function sendTestAction(input: unknown) {
  return newsletterActions().sendTest(getPrincipal, getAuditContext)(input);
}

export async function exportSubscribersAction() {
  return newsletterActions().exportSubscribers(getPrincipal, getAuditContext)({});
}
