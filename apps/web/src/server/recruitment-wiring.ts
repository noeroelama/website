import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  appForRole,
  createFirebaseImageStorage,
  createFirestoreRecruitmentWebStore,
} from "@website/db/firestore";
import type { Recruitment } from "@website/domain/recruitment";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { hasCompleteProfile } from "./profile-wiring";
import { createApplying } from "./recruitment";

export const recruitmentStore = lazyEnv(() => createFirestoreRecruitmentWebStore(webDb()));

/** Published recruitments (cached for minutes under the tag "recruitment"). */
export async function publishedRecruitments(): Promise<Recruitment[]> {
  "use cache";
  cacheTag("recruitment");
  cacheLife("minutes");
  return recruitmentStore().listPublished();
}

/** Private Storage for portfolios (no public URL; FIREBASE_STORAGE_BUCKET). */
const storage = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.FIREBASE_STORAGE_BUCKET) {
    throw new Error("FIREBASE_STORAGE_BUCKET is required for portfolio uploads.");
  }
  return createFirebaseImageStorage(
    appForRole({
      appEnv: env.APP_ENV,
      role: "web_ro",
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    env.FIREBASE_STORAGE_BUCKET,
  );
});

/** /recruitment/[id]: the signed-in member's own application (uid from the session only). */
export const applying = lazyEnv(() =>
  createApplying({
    store: recruitmentStore(),
    profileComplete: hasCompleteProfile,
    storage: {
      save: (path, bytes, options) => storage().save(path, bytes, options),
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);
