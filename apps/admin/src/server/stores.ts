import "server-only";
import { createFirebaseAccountAdmin } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import {
  appForRole,
  createFirebaseImageStorage,
  createFirestoreAccountStore,
  createFirestoreApplicationStore,
  createFirestoreAppointmentStore,
  createFirestoreAuditStore,
  createFirestoreAuditWriter,
  createFirestoreCampaignStore,
  createFirestoreChapterStore,
  createFirestoreContentStore,
  createFirestoreDashboardCounts,
  createFirestoreEventStore,
  createFirestoreFormStore,
  createFirestoreIncomingStore,
  createFirestoreInterviewStore,
  createFirestoreLetterSettingsStore,
  createFirestoreLetterStore,
  createFirestoreLetterTypeStore,
  createFirestoreGalleryStore,
  createFirestoreMemberProfileStore,
  createFirestoreMessageLog,
  createFirestoreOrgUnitStore,
  createFirestorePasskeyStore,
  createFirestorePeriodStore,
  createFirestorePersonalityStore,
  createFirestoreRecruitmentStore,
  createFirestoreRoleStore,
  createFirestoreUniversityStore,
  createFirestoreSubscriberReader,
  createFirestoreSubscriberStore,
  getFirestoreForRole,
} from "@website/db/firestore";
import { createLogger } from "@website/observability";
import { getAdminEnv } from "./env";

const adminRole = () => {
  const env = getAdminEnv();
  return {
    appEnv: env.APP_ENV,
    role: "admin_rw" as const,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  };
};

/** Admin's Firestore client (role `admin_rw`, pooled) and Firebase Auth account operations. */
export const adminDb = lazyEnv(() => getFirestoreForRole(adminRole()));

/** Image uploads: Firebase Storage bucket FIREBASE_STORAGE_BUCKET (required for uploads). */
export const imageStorage = lazyEnv(() => {
  const bucket = getAdminEnv().FIREBASE_STORAGE_BUCKET;
  if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET is required for image uploads.");
  return createFirebaseImageStorage(appForRole(adminRole()), bucket);
});

export const adminStores = lazyEnv(() => {
  const env = getAdminEnv();
  const db = adminDb();
  return {
    accounts: createFirestoreAccountStore(db),
    roles: createFirestoreRoleStore(db),
    passkeys: createFirestorePasskeyStore(db),
    audit: createFirestoreAuditWriter(db),
    auditLog: createFirestoreAuditStore(db),
    messageLog: createFirestoreMessageLog(db),
    content: createFirestoreContentStore(db),
    events: createFirestoreEventStore(db),
    forms: createFirestoreFormStore(db),
    recruitments: createFirestoreRecruitmentStore(db),
    applications: createFirestoreApplicationStore(db),
    interviews: createFirestoreInterviewStore(db),
    personality: createFirestorePersonalityStore(db),
    letters: createFirestoreLetterStore(db),
    letterTypes: createFirestoreLetterTypeStore(db),
    letterSettings: createFirestoreLetterSettingsStore(db),
    incoming: createFirestoreIncomingStore(db),
    galleries: createFirestoreGalleryStore(db),
    chapters: createFirestoreChapterStore(db),
    periods: createFirestorePeriodStore(db),
    orgUnits: createFirestoreOrgUnitStore(db),
    memberProfiles: createFirestoreMemberProfileStore(db),
    universities: createFirestoreUniversityStore(db),
    appointments: createFirestoreAppointmentStore(db),
    campaigns: createFirestoreCampaignStore(db),
    subscribers: {
      ...createFirestoreSubscriberReader(db),
      ...createFirestoreSubscriberStore(db),
    },
    dashboardCounts: createFirestoreDashboardCounts(db),
    authAdmin: createFirebaseAccountAdmin({
      appEnv: env.APP_ENV,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    logger: createLogger({ service: "admin", level: env.LOG_LEVEL }),
  };
});
