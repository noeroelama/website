"use server";

import { certificatePickup } from "@/server/verification-wiring";

export async function findCertificatesAction(input: unknown) {
  return certificatePickup().lookup(input);
}
