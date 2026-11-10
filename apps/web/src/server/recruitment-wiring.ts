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

export async function publishedRecruitments(): Promise<Recruitment[]> {
  "use cache";
  cacheTag("recruitment");
  cacheLife("minutes");
  return recruitmentStore().listPublished();
}

export const applying = lazyEnv(() =>
  createApplying({
    store: recruitmentStore(),
    profileComplete: hasCompleteProfile,
    storage: {
      save: (path, bytes, options) => webStorage().save(path, bytes, options),
      remove: (path) => webStorage().remove(path),
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const personalityResults = lazyEnv(() => createSqlPersonalityStore(webDb()));

export const personalityTest = lazyEnv(() => {
  const secret = getWebEnv().LINK_SIGNING_SECRET;
  if (!secret) throw new Error("LINK_SIGNING_SECRET is required for the personality test.");
  return createPersonalityTest({
    results: personalityResults(),
    secret,
    now: () => new Date(),
  });
});
