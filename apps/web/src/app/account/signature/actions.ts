"use server";

import { ownSignature } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

const owner = async () => {
  const user = await getSignedInUser();
  return user && { uid: user.uid };
};

export async function configureSignatureAction(input: unknown) {
  return ownSignature().configure(await owner(), input);
}

export async function removeSignatureAction() {
  return ownSignature().remove(await owner());
}
