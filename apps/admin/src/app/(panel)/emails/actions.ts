"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { messageActions } from "@/server/wiring";

export async function retryMessageAction(input: unknown) {
  const result = await messageActions().retry(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/emails");
  return result;
}
