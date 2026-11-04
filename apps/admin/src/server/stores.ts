import "server-only";
import { createFirebaseAccountAdmin } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import {
  createDbFileStorage,
  createSqlAccountStore,
  createSqlApplicationStore,
  createSqlAppointmentStore,
  createSqlAuditStore,
  createSqlAuditWriter,
  createSqlCertificateStore,
  createSqlVerificationReader,
  createSqlCampaignStore,
  createSqlChapterStore,
  createSqlContentStore,
  createSqlDashboardCounts,
  createSqlEventStore,
  createSqlFinanceStore,
  createSqlFormStore,
  createSqlIncomingStore,
  createSqlInterviewStore,
  createSqlLetterSettingsStore,
  createSqlLetterStore,
  createSqlLetterTypeStore,
  createSqlGalleryStore,
  createSqlMemberProfileStore,
  createSqlContactReader,
  createSqlMessageLog,
  createSqlOrgUnitStore,
  createSqlPasskeyStore,
  createSqlPeriodStore,
  createSqlPersonalityStore,
  createSqlRecruitmentStore,
  createSqlSignatureStore,
  createSqlRoleStore,
  createSqlUniversityStore,
  createSqlSubscriberReader,
  createSqlSubscriberStore,
  getDatabaseForRole,
  createSqlObjectiveStore,
  createSqlProgramStore,
  createSqlLpjStore,
  createSqlPeriodReport,
} from "@website/db/sql";
import { createLogger } from "@website/observability";
import { getAdminEnv } from "./env";

/** Admin's database (MySQL, role `admin_rw`, pooled). */
export const adminDb = lazyEnv(() => {
  const env = getAdminEnv();
  return getDatabaseForRole({
    role: "admin_rw",
    url: env.DATABASE_URL,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
  });
});

/** Uploads in the MySQL `files` collection; public URLs on WEB_URL. */
export const imageStorage = lazyEnv(() => {
  const env = getAdminEnv();
  return createDbFileStorage({
    db: adminDb(),
    baseUrl: env.WEB_URL ?? "",
    secret: env.LINK_SIGNING_SECRET,
  });
});

export const adminStores = lazyEnv(() => {
  const env = getAdminEnv();
  const db = adminDb();
  return {
    accounts: createSqlAccountStore(db),
    roles: createSqlRoleStore(db),
    passkeys: createSqlPasskeyStore(db),
    audit: createSqlAuditWriter(db),
    auditLog: createSqlAuditStore(db),
    messageLog: createSqlMessageLog(db),
    /** E-mail + WhatsApp number and desk holders, for notifications (J1, J2). */
    contacts: createSqlContactReader(db),
    content: createSqlContentStore(db),
    events: createSqlEventStore(db),
    forms: createSqlFormStore(db),
    recruitments: createSqlRecruitmentStore(db),
    applications: createSqlApplicationStore(db),
    interviews: createSqlInterviewStore(db),
    personality: createSqlPersonalityStore(db),
    letters: createSqlLetterStore(db),
    letterTypes: createSqlLetterTypeStore(db),
    letterSettings: createSqlLetterSettingsStore(db),
    incoming: createSqlIncomingStore(db),
    signatures: createSqlSignatureStore(db),
    certificates: createSqlCertificateStore(db),
    /** Verification codes → sheet + batch (certificate pickup downloads, D5-P). */
    verification: createSqlVerificationReader(db),
    galleries: createSqlGalleryStore(db),
    chapters: createSqlChapterStore(db),
    periods: createSqlPeriodStore(db),
    orgUnits: createSqlOrgUnitStore(db),
    memberProfiles: createSqlMemberProfileStore(db),
    universities: createSqlUniversityStore(db),
    appointments: createSqlAppointmentStore(db),
    campaigns: createSqlCampaignStore(db),
    subscribers: {
      ...createSqlSubscriberReader(db),
      ...createSqlSubscriberStore(db),
    },
    dashboardCounts: createSqlDashboardCounts(db),
    authAdmin: createFirebaseAccountAdmin({
      appEnv: env.APP_ENV,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    logger: createLogger({ service: "admin", level: env.LOG_LEVEL }),
    objectives: createSqlObjectiveStore(db),
    programs: createSqlProgramStore(db),
    lpj: createSqlLpjStore(db),
    periodReport: createSqlPeriodReport(db),
    /** Finance requests (I1). */
    finance: createSqlFinanceStore(db),
  };
});
