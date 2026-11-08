"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { exportLog, meetingActions, minutesActions } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/meetings", "layout");
  return result;
};

export async function saveMeetingAction(input: unknown) {
  return done(await meetingActions().save(getPrincipal, getAuditContext)(input));
}
export async function saveRoomAction(input: unknown) {
  return done(await meetingActions().saveRoom(getPrincipal, getAuditContext)(input));
}
export async function cancelMeetingAction(input: unknown) {
  return done(await meetingActions().cancel(getPrincipal, getAuditContext)(input));
}
export async function markAttendanceAction(input: unknown) {
  return done(await meetingActions().mark(getPrincipal, getAuditContext)(input));
}
export async function openCodeAction(input: unknown) {
  return meetingActions().openCode(getPrincipal, getAuditContext)(input);
}
export async function saveMinutesAction(input: unknown) {
  return done(await minutesActions().save(getPrincipal, getAuditContext)(input));
}
export async function approveMinutesAction(input: unknown) {
  return done(await minutesActions().approve(getPrincipal, getAuditContext)(input));
}
export async function saveActionItemAction(input: unknown) {
  return done(await minutesActions().saveItem(getPrincipal, getAuditContext)(input));
}
export async function setActionItemDoneAction(input: unknown) {
  return done(await minutesActions().setItemDone(getPrincipal, getAuditContext)(input));
}
export async function removeActionItemAction(input: unknown) {
  return done(await minutesActions().removeItem(getPrincipal, getAuditContext)(input));
}
export async function draftMinutesAction(input: unknown) {
  return done(await minutesActions().draft(getPrincipal, getAuditContext)(input));
}

export async function logAttendanceExportAction(input: unknown) {
  return exportLog().attendance(getPrincipal, getAuditContext)(input);
}
