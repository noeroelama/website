"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { lpjActions } from "@/server/wiring";

type Name = keyof ReturnType<typeof lpjActions>;
const run = async (name: Name, input: unknown) => {
  const result = await lpjActions()[name](getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/lpj", "layout");
  return result;
};

export async function saveLpjAction(input: unknown) {
  return run("save", input);
}
export async function submitLpjAction(input: unknown) {
  return run("submit", input);
}
export async function reviewSecretariatAction(input: unknown) {
  return run("reviewSecretariat", input);
}
export async function reviewTreasurerAction(input: unknown) {
  return run("reviewTreasurer", input);
}
export async function approveLpjAction(input: unknown) {
  return run("approve", input);
}
export async function returnLpjAction(input: unknown) {
  return run("returnToPics", input);
}
export async function extendLpjAction(input: unknown) {
  return run("extend", input);
}
