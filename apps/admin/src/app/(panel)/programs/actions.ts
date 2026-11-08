"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { programActions } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/programs", "layout");
  return result;
};
type Name = keyof ReturnType<typeof programActions>;
const run = async (name: Name, input: unknown) =>
  done(await programActions()[name](getPrincipal, getAuditContext)(input));

export async function saveProgramAction(input: unknown) {
  return run("save", input);
}
export async function approveProgramAction(input: unknown) {
  return run("approve", input);
}
export async function returnProgramAction(input: unknown) {
  return run("returnToProposal", input);
}
export async function cancelProgramAction(input: unknown) {
  return run("cancel", input);
}
export async function startProgramAction(input: unknown) {
  return run("start", input);
}
export async function finishProgramAction(input: unknown) {
  return run("finish", input);
}
export async function setHealthAction(input: unknown) {
  return run("health", input);
}
export async function saveMilestoneAction(input: unknown) {
  return run("saveMilestone", input);
}
export async function deleteMilestoneAction(input: unknown) {
  return run("deleteMilestone", input);
}
export async function markMilestoneAction(input: unknown) {
  return run("markMilestone", input);
}
export async function checkInAction(input: unknown) {
  return run("checkIn", input);
}
