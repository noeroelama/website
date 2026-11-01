import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlPersonalityStore, createSqlRecruitmentWebStore } from "@website/db/sql";
import type { Recruitment } from "@website/domain/recruitment";
import { webDb, webStorage } from "./db";
import { getWebEnv } from "./env";
import { hasCompleteProfile } from "./profile-wiring";
import { createPersonalityTest } from "./personality";
import { createApplying } from "./recruitment";

export const recruitmentStore = lazyEnv(() => createSqlRecruitmentWebStore(webDb()));

/** Published recruitments (cached for minutes under the tag "recruitment"). */
export async function publishedRecruitments(): Promise<Recruitment[]> {
  "use cache";
  cacheTag("recruitment");
  cacheLife("minutes");
  return recruitmentStore().listPublished();
}

/** /recruitment/[id]: the signed-in member's own application (uid from the session only). */
export const applying = lazyEnv(() =>
  createApplying({
    store: recruitmentStore(),
    profileComplete: hasCompleteProfile,
    storage: {
      save: (path, bytes, options) => webStorage().save(path, bytes, options),
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** `personalityResults/{uid}` with the website's client (the applicant's own result). */
export const personalityResults = lazyEnv(() => createSqlPersonalityStore(webDb()));

/** The personality test (C5): signed 7-day links (LINK_SIGNING_SECRET), one result per person. */
export const personalityTest = lazyEnv(() => {
  const secret = getWebEnv().LINK_SIGNING_SECRET;
  if (!secret) throw new Error("LINK_SIGNING_SECRET is required for the personality test.");
  return createPersonalityTest({
    results: personalityResults(),
    secret,
    now: () => new Date(),
  });
});
