"use server";

import { ownProfile } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

// Thin wrapper: every rule lives in src/server/profile.ts. The owner comes from the session.
export async function saveProfileAction(input: unknown) {
  return ownProfile().save(await getSignedInUser(), input);
}
