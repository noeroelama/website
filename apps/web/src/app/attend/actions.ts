"use server";

import type { AttendResult } from "@/server/attendance";
import { attend } from "@/server/attendance-wiring";
import { getSignedInUser } from "@/server/session";

export async function attendAction(code: unknown): Promise<AttendResult> {
  const user = await getSignedInUser();
  return attend()(user?.uid ?? null, typeof code === "string" ? code.slice(0, 32) : "");
}
