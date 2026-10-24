import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hasTwoSignInMethods } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import type { UserListQuery } from "@website/db";
import type { AuditListQuery, FirestoreFormStore } from "@website/db/firestore";
import { trackingLinkData, unsubscribeLinkData } from "@website/domain/newsletter";
import { logSecurityEvent } from "@website/observability";
import { keyedHash, signLink } from "@website/security";
import { createAccountActions } from "./accounts";
import { createApplicationActions } from "./applications";
import { createAppointmentActions } from "./appointments";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createChapterActions } from "./chapters";
import { createMessenger } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { createCronRoute, CRON_JOBS } from "./cron";
import { createDashboard } from "./dashboard";
import { createEventActions } from "./events";
import { createFormActions } from "./forms";
import { createGalleryActions } from "./gallery";
import { getAdminEnv, getAppUrls } from "./env";
import { createImageUploads } from "./images";
import { createInterviewActions } from "./interviews";
import { createMemberActions } from "./members";
import { createMessageActions } from "./messaging";
import { createNewsletterActions } from "./newsletter";
import { createNewsActions } from "./news";
import { createOrgUnitActions } from "./org-units";
import { createPeriodActions } from "./periods";
import { createRecruitmentActions } from "./recruitment";
import { createRoleActions } from "./roles";
import { createUniversityActions } from "./universities";
import { adminStores, imageStorage } from "./stores";

/** Users and Roles page actions with the real stores (server actions call these). */
export const accountActions = lazyEnv(() => createAccountActions(adminStores()));
export const roleActions = lazyEnv(() =>
  createRoleActions({ roles: adminStores().roles, now: () => new Date() }),
);

/** Article page (News) actions. */
export const newsActions = lazyEnv(() =>
  createNewsActions({ content: adminStores().content, now: () => new Date() }),
);

/** Event page actions. */
export const eventActions = lazyEnv(() =>
  createEventActions({ events: adminStores().events, now: () => new Date(), uuid: randomUUID }),
);

/** Gallery page actions. */
export const galleryActions = lazyEnv(() =>
  createGalleryActions({
    albums: adminStores().galleries,
    events: adminStores().events,
    now: () => new Date(),
  }),
);

/** Organizations → PPI (chapters) actions. */
export const chapterActions = lazyEnv(() =>
  createChapterActions({ chapters: adminStores().chapters, now: () => new Date() }),
);

/** Organizations → Period (board periods) actions. */
export const periodActions = lazyEnv(() =>
  createPeriodActions({ periods: adminStores().periods, now: () => new Date() }),
);

/** Organizations → Period → Structure (org units) actions. */
export const orgUnitActions = lazyEnv(() =>
  createOrgUnitActions({ units: adminStores().orgUnits, now: () => new Date() }),
);

/** Forms page: the form builder (versioned questions). */
export const formActions = lazyEnv(() =>
  createFormActions({
    forms: adminStores().forms,
    now: () => new Date(),
    uuid: randomUUID,
    token: () => randomBytes(16).toString("base64url"),
    logExport: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "data.export", actorId, details }),
  }),
);

/** Recruitment page: set-up (window, units and seats, form). */
export const recruitmentActions = lazyEnv(() =>
  createRecruitmentActions({ recruitments: adminStores().recruitments, now: () => new Date() }),
);

/** Recruitment → Applications: the selection queue (review, offers, files). */
export const applicationActions = lazyEnv(() =>
  createApplicationActions({
    applications: adminStores().applications,
    signedUrl: (path) => imageStorage().signedReadUrl(path),
    appointments: adminStores().appointments,
    units: adminStores().orgUnits,
    roles: adminStores().roles,
    hasSecondFactor: async (uid) => {
      const { authAdmin, passkeys } = adminStores();
      const [methods, keys] = await Promise.all([
        authAdmin.signInMethods(uid),
        passkeys.listByUser(uid),
      ]);
      return hasTwoSignInMethods({ ...methods, passkeys: keys.length });
    },
    afterRoleChange: async (actor, uid, details) => {
      await adminStores().authAdmin.revokeSessions(uid);
      logSecurityEvent(adminStores().logger, {
        type: "staff.role_changed",
        actorId: actor.userId,
        details: { targetId: uid, ...details },
      });
    },
    now: () => new Date(),
  }),
);

/** Recruitment → Interviews: interview times (day plans) and the day view. */
export const interviewActions = lazyEnv(() =>
  createInterviewActions({ interviews: adminStores().interviews, now: () => new Date() }),
);

/** Universities page: review of proposed campuses. */
export const universityActions = lazyEnv(() =>
  createUniversityActions({ universities: adminStores().universities, now: () => new Date() }),
);

/** Structure page: appointments and the roles they give. */
export const appointmentActions = lazyEnv(() => {
  const stores = adminStores();
  return createAppointmentActions({
    ...stores,
    units: stores.orgUnits,
    now: () => new Date(),
  });
});

/** Members page: verification, data changes, graduation. */
export const memberActions = lazyEnv(() =>
  createMemberActions({ profiles: adminStores().memberProfiles, now: () => new Date() }),
);

/** POST /api/uploads/<preset> (src/app/api/uploads/[preset]/route.ts). */
export const imageUploads = lazyEnv(() =>
  createImageUploads({
    storage: imageStorage(),
    appendAudit: (event) => adminStores().audit.appendAlone(event),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** Audit Log page: revert status per entry and the revert action. */
export const auditLogActions = lazyEnv(() =>
  createAuditLogActions({
    audit: adminStores().auditLog,
    revertible: REVERTIBLE_COLLECTIONS,
    now: () => new Date(),
    logSecurityEvent: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "audit.revert", actorId, details }),
  }),
);

/** GET /cron/<job> (src/app/cron/[job]/route.ts). */
export const cronRoute = lazyEnv(() =>
  createCronRoute({
    secret: getAdminEnv().CRON_SECRET,
    jobs: { ...CRON_JOBS, "newsletter-send": () => newsletterActions().runBatch() },
    log: ({ message, ...fields }) =>
      message === "cron_job_failed"
        ? adminStores().logger.error(String(message), fields)
        : adminStores().logger.info(String(message), fields),
  }),
);

/**
 * Outgoing messages from admin (docs: apps/admin/docs/messaging.md). Call
 * `messenger().send(message, key)` AFTER the transaction that caused the message commits.
 */
export const messenger = lazyEnv(() => {
  const env = getAdminEnv();
  return createMessenger({
    log: adminStores().messageLog,
    channels: {
      email: emailChannel(
        env.RESEND_API_KEY ? createResendSender({ apiKey: env.RESEND_API_KEY }) : null,
        env.EMAIL_FROM_TRANSACTIONAL,
      ),
    },
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    now: () => new Date(),
  });
});
/** A signed link on the website (newsletter pages); needs LINK_SIGNING_SECRET and WEB_URL. */
function webLink(path: string, data: Record<string, string>): string {
  const secret = getAdminEnv().LINK_SIGNING_SECRET;
  const web = getAppUrls().WEB_URL;
  if (!secret || !web) throw new Error("LINK_SIGNING_SECRET and WEB_URL are required.");
  return `${web}${path}?t=${signLink(data, secret)}`;
}

/**
 * Newsletter page actions and the "newsletter-send" cron job. Unsubscribe, open and click links
 * need LINK_SIGNING_SECRET and staff-added subscribers SUBSCRIBER_HASH_SECRET (the same values as
 * apps/web), plus WEB_URL.
 */
export const newsletterActions = lazyEnv(() =>
  createNewsletterActions({
    campaigns: adminStores().campaigns,
    subscribers: adminStores().subscribers,
    send: (message, key) => messenger().send(message, key),
    unsubscribeUrl: (subscriberId) =>
      webLink("/newsletter/unsubscribe", unsubscribeLinkData(subscriberId)),
    openUrl: (campaignId, subscriberId) =>
      webLink("/newsletter/o", trackingLinkData("open", campaignId, subscriberId)),
    clickUrl: (campaignId, subscriberId, url) =>
      webLink("/newsletter/c", trackingLinkData("click", campaignId, subscriberId, url)),
    subscriberId: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required.");
      return keyedHash("subscriber", email, secret);
    },
    newToken: () => randomBytes(32).toString("base64url"),
    confirmUrl: (id, token) =>
      `${getAppUrls().WEB_URL ?? ""}/newsletter/confirm?s=${id}&t=${token}`,
    chapters: () => adminStores().chapters.listForAdmin(),
    staffEmail: async (uid) => (await adminStores().accounts.get(uid))?.email ?? null,
    logExport: (actorId, rows) =>
      logSecurityEvent(adminStores().logger, {
        type: "data.export",
        actorId,
        details: { dataset: "newsletter_subscribers", rows },
      }),
    now: () => new Date(),
    batchSize: 100,
  }),
);

export const messageActions = lazyEnv(() => createMessageActions({ messenger: messenger() }));

/** Dashboard: counters for the pages the viewer can read, newest audit entries with audit.read. */
export const dashboard = lazyEnv(() =>
  createDashboard({
    counts: adminStores().dashboardCounts,
    listAudit: (query) => adminStores().auditLog.list(query),
    graduatedOfficers: () =>
      adminStores().appointments.graduatedOfficers(new Date().toISOString().slice(0, 10)),
  }),
);

/** Reads for the admin pages. Callers check the page's `.read` permission first. */
export const adminReads = {
  listUsers: (query: UserListQuery) => adminStores().accounts.list(query),
  getUser: (uid: string) => adminStores().accounts.get(uid),
  getUsers: (uids: readonly string[]) => adminStores().accounts.getMany(uids),
  listRoles: () => adminStores().roles.list(),
  listAudit: (query: AuditListQuery) => adminStores().auditLog.list(query),
  listFailedMessages: (cursor: string | undefined) =>
    adminStores().messageLog.listFailed({ cursor, limit: 25 }),
  getRole: (id: string) => adminStores().roles.get(id),
  listNews: () => adminStores().content.listForAdmin("news"),
  getContent: (id: string) => adminStores().content.get(id),
  listEvents: () => adminStores().events.listForAdmin(),
  listForms: () => adminStores().forms.listForAdmin(),
  listRecruitments: () => adminStores().recruitments.listForAdmin(),
  getRecruitment: (id: string) => adminStores().recruitments.get(id),
  listApplications: (recruitmentId: string) =>
    adminStores().applications.listForRecruitment(recruitmentId),
  listRevisions: (recruitmentId: string) =>
    adminStores().applications.revisionsForRecruitment(recruitmentId),
  getFormVersion: (formId: string, n: number) => adminStores().forms.getVersion(formId, n),
  personalityResults: (uids: readonly string[]) => adminStores().personality.getMany(uids),
  listInterviewSlots: (recruitmentId: string) =>
    adminStores().interviews.listForRecruitment(recruitmentId),
  recruitmentSeats: (ids: readonly string[]) => adminStores().recruitments.seats(ids),
  getForm: (id: string) => adminStores().forms.get(id),
  listFormVersions: (id: string) => adminStores().forms.listVersions(id),
  listFormResponses: (id: string, limit: number) => adminStores().forms.listResponses(id, limit),
  currentFormVersions: (forms: Parameters<FirestoreFormStore["currentVersions"]>[0]) =>
    adminStores().forms.currentVersions(forms),
  listAlbums: () => adminStores().galleries.listForAdmin(),
  listChapters: () => adminStores().chapters.listForAdmin(),
  listPeriods: () => adminStores().periods.listForAdmin(),
  getPeriod: (id: string) => adminStores().periods.get(id),
  listOrgUnits: (periodId: string) => adminStores().orgUnits.listForPeriod(periodId),
  getOrgUnit: (id: string) => adminStores().orgUnits.get(id),
  listAppointments: (periodId: string) => adminStores().appointments.listForPeriod(periodId),
  getAppointmentRoleMap: () => adminStores().appointments.getRoleMap(),
  listPendingUniversities: () => adminStores().universities.listPending(),
  getMemberProfile: (uid: string) => adminStores().memberProfiles.findByUserId(uid),
  listToVerify: (chapterIds: "all" | string[]) =>
    adminStores().memberProfiles.listToVerify(chapterIds),
  listChangeRequests: (chapterIds: "all" | string[]) =>
    adminStores().memberProfiles.listChangeRequests(chapterIds),
  listApprovedUniversities: (countryCode: string) =>
    adminStores().universities.listApproved(countryCode),
  listCampaigns: () => adminStores().campaigns.listForAdmin(),
  listSubscribers: () => adminStores().subscribers.listForAdmin(),
  countHolders: (ids: readonly string[]) => adminStores().roles.countHolders(ids),
  signInMethods: async (uid: string) => {
    const { authAdmin, passkeys } = adminStores();
    const [methods, keys] = await Promise.all([
      authAdmin.signInMethods(uid),
      passkeys.listByUser(uid),
    ]);
    return { ...methods, passkeys: keys.length };
  },
};
