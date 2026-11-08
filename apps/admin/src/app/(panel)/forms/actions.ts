"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { formActions } from "@/server/wiring";

export async function saveFormAction(input: unknown) {
  const result = await formActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/forms");
  return result;
}

export async function removeFormAction(input: unknown) {
  const result = await formActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/forms");
  return result;
}

export async function publishFormAction(input: unknown) {
  const result = await formActions().publish(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/forms");
  return result;
}

export async function closeFormAction(input: unknown) {
  const result = await formActions().close(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/forms");
  return result;
}

export async function exportFormResponsesAction(input: unknown) {
  return formActions().exportResponses(getPrincipal, getAuditContext)(input);
}
