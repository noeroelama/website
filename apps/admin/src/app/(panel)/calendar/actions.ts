"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { calendar } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/calendar");
  return result;
};

export async function revokeFeedAction(input: unknown) {
  return done(await calendar().revokeFeed(getPrincipal, getAuditContext)(input));
}
export async function addHolidayAction(input: unknown) {
  return done(await calendar().addHoliday(getPrincipal, getAuditContext)(input));
}
export async function removeHolidayAction(input: unknown) {
  return done(await calendar().removeHoliday(getPrincipal, getAuditContext)(input));
}
