/**
 * Database access (MySQL 8 on cPanel). `mysql2` is imported only in ./store.ts (lint-enforced),
 * so storage details stay out of domain and UI code.
 */
import { getDatabase, type Database } from "./store";
import type { DatabaseRole } from "../roles";

export {
  StoredTimestamp,
  getDatabase,
  type CollectionReference,
  type Database,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from "./store";
export { createSqlRateLimitStore } from "./rate-limit";
export {
  createSqlAuditStore,
  createSqlAuditWriter,
  type AuditListQuery,
  type SqlAuditStore,
  type SqlAuditWriter,
  type RevertibleCollections,
  type RevertOutcome,
} from "./audit";
export { getDocumentsByIds } from "./batch";
export { deleteExpired, EXPIRING_COLLECTIONS } from "./expiry";
export { nextNumbers } from "./counters";
export { createSqlSignatureStore, type SqlSignatureStore } from "./signatures";
export {
  createSqlIncomingStore,
  incomingSnapshot,
  type SqlIncomingStore,
  type IncomingAudit,
} from "./incoming";
export {
  createSqlLetterSettingsStore,
  createSqlLetterStore,
  createSqlLetterTypeStore,
  createSqlVerificationReader,
  letterSnapshot,
  letterTypeSnapshot,
  type SqlLetterSettingsStore,
  type SqlLetterStore,
  type SqlLetterTypeStore,
  type SqlVerificationReader,
  type LetterAudit,
  type LetterListQuery,
} from "./letters";
export {
  createSqlCertificateStore,
  type CertificateAudit,
  type SqlCertificateStore,
} from "./certificates";
export {
  cashEntrySnapshot,
  createSqlFinanceStore,
  financeSnapshot,
  type CashAudit,
  type FinanceAudit,
  type FinanceListQuery,
  type SqlFinanceStore,
} from "./finance";
export { createSqlPasskeyStore } from "./passkeys";
export {
  checkFilePath,
  createDbFileStorage,
  createDiskFileStorage,
  fileContentType,
  FILE_LINK_PURPOSE,
  type FileVisibility,
} from "./storage";
export { createSqlWebhookEventStore } from "./webhooks";
export {
  createSqlContactReader,
  createSqlMessageLog,
  type SqlContactReader,
  type SqlMessageLog,
} from "./messages";
export {
  createSqlDashboardCounts,
  type DashboardCounter,
  type SqlDashboardCounts,
} from "./dashboard";
export {
  createSqlSubscriberReader,
  createSqlSubscriberStore,
  subscriberSnapshot,
  type SqlSubscriberReader,
  type SqlSubscriberStore,
  type SubscriberRow,
} from "./subscribers";
export {
  campaignSnapshot,
  createSqlCampaignStore,
  createSqlCampaignWebStore,
  type CampaignFields,
  type SqlCampaignStore,
  type SqlCampaignWebStore,
} from "./campaigns";
export {
  chapterSnapshot,
  createSqlChapterReader,
  createSqlChapterStore,
  type ChapterFields,
  type SqlChapterReader,
  type SqlChapterStore,
} from "./chapters";
export {
  appointmentSnapshot,
  createSqlAppointmentStore,
  type AppointmentAudit,
  type SqlAppointmentStore,
} from "./appointments";
export { createSqlMemberProfileStore, type SqlMemberProfileStore } from "./member-profiles";
export {
  createSqlUniversityStore,
  type SqlUniversityStore,
  type UniversityDecision,
} from "./universities";
export {
  createSqlOrgUnitStore,
  orgUnitSnapshot,
  type SqlOrgUnitStore,
  type OrgUnitAudit,
  type OrgUnitFields,
} from "./org-units";
export {
  createSqlPeriodStore,
  periodSnapshot,
  type SqlPeriodStore,
  type PeriodFields,
  type PeriodStatusAudit,
} from "./periods";
export {
  albumSnapshot,
  createSqlGalleryReader,
  createSqlGalleryStore,
  type AlbumFields,
  type SqlGalleryReader,
  type SqlGalleryStore,
} from "./gallery";
export {
  createSqlEventReader,
  createSqlEventStore,
  createSqlRegistrationStore,
  eventSnapshot,
  type EventFields,
  type SqlEventReader,
  type SqlEventStore,
  type SqlRegistrationStore,
} from "./events";
export {
  contentSnapshot,
  createSqlNewsReader,
  createSqlContentStore,
  type ContentFields,
  type SqlContentStore,
  type SqlNewsReader,
} from "./content";
export {
  createSqlFormStore,
  createSqlFormWebStore,
  formSnapshot,
  type SqlFormStore,
  type SqlFormWebStore,
  type SubmitOutcome,
  type FormAudit,
  type FormFields,
  type FormSettings,
} from "./forms";
export {
  createSqlPersonalityStore,
  type SqlPersonalityStore,
  type PersonalityResult,
} from "./personality";
export {
  applicationSnapshot,
  createSqlApplicationStore,
  createSqlInterviewStore,
  createSqlRecruitmentStore,
  createSqlRecruitmentWebStore,
  recruitmentSnapshot,
  toApplication,
  type ApplicationAudit,
  type ApplyOutcome,
  type Decision,
  type SqlApplicationStore,
  type SqlInterviewStore,
  type SqlRecruitmentStore,
  type SqlRecruitmentWebStore,
  type RecruitmentAudit,
  type RecruitmentFields,
} from "./recruitment";
export {
  createSqlAccountStore,
  createSqlRoleStore,
  createSqlUserStore,
  inviteId,
  type SqlAccountStore,
  type SqlRoleStore,
} from "./users";
export {
  createSqlObjectiveStore,
  createSqlProgramStore,
  createSqlLpjStore,
  createSqlPeriodReport,
  type SqlPeriodReport,
  lpjSnapshot,
  type LpjAudit,
  type SqlLpjStore,
  objectiveSnapshot,
  programSnapshot,
  type CheckinAudit,
  type ObjectiveAudit,
  type ObjectiveFields,
  type ProgramAudit,
  type ProgramFields,
  type SqlObjectiveStore,
  type SqlProgramStore,
} from "./programs";
export {
  createSqlMeetingStore,
  meetingSnapshot,
  type MeetingAudit,
  type MeetingFields,
  type SqlMeetingStore,
} from "./meetings";

if ("window" in globalThis) {
  throw new Error("@website/db must never be bundled into browser code.");
}

export interface DatabaseRoleConfig {
  readonly role: DatabaseRole;
  /** `DATABASE_URL`: each app has its own MySQL user (least privilege, separate revocation). */
  readonly url: string;
  readonly connectionLimit?: number | undefined;
}

/**
 * The database for an app's role. Connection pooling: one pool per database URL per server
 * process, reused for every request. Never open a connection per request.
 */
export function getDatabaseForRole(config: DatabaseRoleConfig): Database {
  return getDatabase({ url: config.url, connectionLimit: config.connectionLimit });
}
