"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { zoomActions } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/zoom");
  return result;
};

export async function requestZoomAction(input: unknown) {
  return done(await zoomActions().request(getPrincipal, getAuditContext)(input));
}
export async function approveZoomAction(input: unknown) {
  return done(await zoomActions().approve(getPrincipal, getAuditContext)(input));
}
export async function rejectZoomAction(input: unknown) {
  return done(await zoomActions().reject(getPrincipal, getAuditContext)(input));
}
export async function cancelZoomAction(input: unknown) {
  return done(await zoomActions().cancel(getPrincipal, getAuditContext)(input));
}
export async function saveZoomSettingsAction(input: unknown) {
  return done(await zoomActions().saveSettings(getPrincipal, getAuditContext)(input));
}
