"use server";

import { z } from "zod";
import { campusChoices, ownProfile, universityPicker } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

// Thin wrappers: every rule lives in src/server/{profile,universities}.ts. The owner comes from
// the session, never from the form.
export async function saveProfileAction(input: unknown) {
  return ownProfile().save(await getSignedInUser(), input);
}

const CountryCode = z.string().regex(/^[A-Z]{2}$/);

/** Campuses of one PPI country for the picker (approved + the member's own proposals). */
export async function campusChoicesAction(countryCode: unknown) {
  const parsed = CountryCode.safeParse(countryCode);
  return parsed.success ? campusChoices(await getSignedInUser(), parsed.data) : [];
}

/** "My campus is not listed": a proposal that staff review. */
export async function proposeCampusAction(input: unknown) {
  return universityPicker().propose(await getSignedInUser(), input);
}

/** Mark, correct or cancel (graduatedOn null) the member's own graduation (B5). */
export async function setGraduationAction(input: unknown) {
  return ownProfile().setGraduation(await getSignedInUser(), input);
}
