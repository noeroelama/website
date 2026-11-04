"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { meetingActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/meetings.ts (createGuardedAction).
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
