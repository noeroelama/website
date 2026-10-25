import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createFirestoreMemberProfileStore,
  createFirestoreSignatureStore,
  createFirestoreUniversityStore,
} from "@website/db/firestore";
import { isProfileComplete } from "@website/domain/members";
import { webDb, webStorage } from "./db";
import { getWebEnv } from "./env";
import { createOwnProfile, type ProfileOwner } from "./profile";
import { createOwnSignature } from "./signature";
import { createUniversityPicker, type UniversityChoice } from "./universities";

/** `memberProfiles/{uid}` and `universities/{id}` with the website's Firestore client. */
const memberProfiles = lazyEnv(() => createFirestoreMemberProfileStore(webDb()));
const universities = lazyEnv(() => createFirestoreUniversityStore(webDb()));

/** /account/profile: the signed-in member's own profile. */
export const ownProfile = lazyEnv(() =>
  createOwnProfile({
    profiles: memberProfiles(),
    universities: universities(),
    now: () => new Date(),
  }),
);

/** /account/signature: the signed-in person's own signature (D4), stored encrypted. */
export const ownSignature = lazyEnv(() =>
  createOwnSignature({
    store: createFirestoreSignatureStore(webDb()),
    storage: webStorage(),
    key: () => getWebEnv().FIELD_ENCRYPTION_KEY ?? null,
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** Gate for member-only actions (event registration). */
export const hasCompleteProfile = async (uid: string): Promise<boolean> =>
  isProfileComplete(await memberProfiles().findByUserId(uid));

/** The member's own IANA time zone (profile), for showing times on their clock (C3-I). */
export const ownTimezone = async (uid: string): Promise<string> =>
  (await memberProfiles().findByUserId(uid))?.timezone ?? "Asia/Jakarta";

export const universityPicker = lazyEnv(() =>
  createUniversityPicker({ universities: universities(), now: () => new Date() }),
);

/** The approved campuses of one country (cached for minutes under the tag "universities"). */
async function approvedCampuses(countryCode: string): Promise<UniversityChoice[]> {
  "use cache";
  cacheTag("universities");
  cacheLife("minutes");
  return universityPicker().approved(countryCode);
}

/** Picker choices: the cached approved list plus the member's own pending proposals. */
export async function campusChoices(
  owner: ProfileOwner | null,
  countryCode: string,
): Promise<UniversityChoice[]> {
  const [approved, mine] = await Promise.all([
    approvedCampuses(countryCode),
    universityPicker().ownPending(owner, countryCode),
  ]);
  return [...approved, ...mine];
}
