"use server";

import { certificatePickup } from "@/server/verification-wiring";

/** Find button of /certificates (D5-P): the server re-checks the captcha and the e-mail. */
export async function findCertificatesAction(input: unknown) {
  return certificatePickup().lookup(input);
}
