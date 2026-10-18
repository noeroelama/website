import "server-only";
import { lazyEnv } from "@website/config/env";
import { createFirestoreMemberProfileStore } from "@website/db/firestore";
import { isProfileComplete } from "@website/domain/members";
import { webDb } from "./db";
import { createOwnProfile } from "./profile";

/** `memberProfiles/{uid}` with the website's Firestore client. */
const memberProfiles = lazyEnv(() => createFirestoreMemberProfileStore(webDb()));

/** /account/profile: the signed-in member's own profile. */
export const ownProfile = lazyEnv(() =>
  createOwnProfile({ profiles: memberProfiles(), now: () => new Date() }),
);

/** Gate for member-only actions (event registration). */
export const hasCompleteProfile = async (uid: string): Promise<boolean> =>
  isProfileComplete(await memberProfiles().findByUserId(uid));
