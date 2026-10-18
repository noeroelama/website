"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { eventActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/events.ts (createGuardedAction).
export async function saveEventAction(input: unknown) {
  const result = await eventActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function setEventPublishedAction(input: unknown) {
  const result = await eventActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}

export async function removeEventAction(input: unknown) {
  const result = await eventActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/events", "layout");
  return result;
}
