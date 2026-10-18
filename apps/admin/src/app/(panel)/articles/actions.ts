"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { newsActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/news.ts (createGuardedAction).
export async function saveNewsAction(input: unknown) {
  const result = await newsActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/articles", "layout");
  return result;
}

export async function setNewsPublishedAction(input: unknown) {
  const result = await newsActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/articles", "layout");
  return result;
}

export async function removeNewsAction(input: unknown) {
  const result = await newsActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/articles", "layout");
  return result;
}
