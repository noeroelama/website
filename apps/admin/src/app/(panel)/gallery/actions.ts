"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { galleryActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/gallery.ts (createGuardedAction).
export async function saveAlbumAction(input: unknown) {
  const result = await galleryActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/gallery", "layout");
  return result;
}

export async function setAlbumPublishedAction(input: unknown) {
  const result = await galleryActions().setPublished(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/gallery", "layout");
  return result;
}

export async function removeAlbumAction(input: unknown) {
  const result = await galleryActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/gallery", "layout");
  return result;
}
