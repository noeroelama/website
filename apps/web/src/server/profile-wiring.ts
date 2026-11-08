import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createSqlMemberProfileStore,
  createSqlSignatureStore,
  createSqlUniversityStore,
} from "@website/db/sql";
import { isProfileComplete } from "@website/domain/members";
import { webDb, webStorage } from "./db";
import { getWebEnv } from "./env";
import { createOwnProfile, type ProfileOwner } from "./profile";
import { createOwnSignature } from "./signature";
import { createUniversityPicker, type UniversityChoice } from "./universities";

const memberProfiles = lazyEnv(() => createSqlMemberProfileStore(webDb()));
const universities = lazyEnv(() => createSqlUniversityStore(webDb()));

export const ownProfile = lazyEnv(() =>
  createOwnProfile({
    profiles: memberProfiles(),
    universities: universities(),
    now: () => new Date(),
  }),
);

export const ownSignature = lazyEnv(() =>
  createOwnSignature({
    store: createSqlSignatureStore(webDb()),
    storage: webStorage(),
    key: () => getWebEnv().FIELD_ENCRYPTION_KEY ?? null,
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const hasCompleteProfile = async (uid: string): Promise<boolean> =>
  isProfileComplete(await memberProfiles().findByUserId(uid));

export const ownTimezone = async (uid: string): Promise<string> =>
  (await memberProfiles().findByUserId(uid))?.timezone ?? "Asia/Jakarta";

export const universityPicker = lazyEnv(() =>
  createUniversityPicker({ universities: universities(), now: () => new Date() }),
);

async function approvedCampuses(countryCode: string): Promise<UniversityChoice[]> {
  "use cache";
  cacheTag("universities");
  cacheLife("minutes");
  return universityPicker().approved(countryCode);
}

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
