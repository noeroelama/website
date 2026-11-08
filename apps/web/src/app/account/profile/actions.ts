"use server";

import { z } from "zod";
import { campusChoices, ownProfile, universityPicker } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

export async function saveProfileAction(input: unknown) {
  return ownProfile().save(await getSignedInUser(), input);
}

const CountryCode = z.string().regex(/^[A-Z]{2}$/);

export async function campusChoicesAction(countryCode: unknown) {
  const parsed = CountryCode.safeParse(countryCode);
  return parsed.success ? campusChoices(await getSignedInUser(), parsed.data) : [];
}

export async function proposeCampusAction(input: unknown) {
  return universityPicker().propose(await getSignedInUser(), input);
}

export async function setGraduationAction(input: unknown) {
  return ownProfile().setGraduation(await getSignedInUser(), input);
}
