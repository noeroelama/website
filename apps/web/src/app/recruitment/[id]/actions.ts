"use server";

import { applying } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";

const applicant = async () => {
  const user = await getSignedInUser();
  return user && { uid: user.uid };
};

export async function saveApplicationDraftAction(input: unknown) {
  return applying().saveDraft(await applicant(), input);
}

export async function submitApplicationAction(input: unknown) {
  return applying().submit(await applicant(), input);
}

export async function withdrawApplicationAction(input: unknown) {
  return applying().withdraw(await applicant(), input);
}

export async function respondOfferAction(input: unknown) {
  return applying().respondOffer(await applicant(), input);
}

export async function bookInterviewAction(input: unknown) {
  return applying().bookInterview(await applicant(), input);
}
