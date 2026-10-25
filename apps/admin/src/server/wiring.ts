import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { lazyEnv } from "@website/config/env";
import { inviteId, type AuditListQuery } from "@website/db/firestore";
import { trackingLinkData, unsubscribeLinkData } from "@website/domain/newsletter";
import { logSecurityEvent } from "@website/observability";
import { keyedHash, signLink } from "@website/security";
import { createAccountActions } from "./accounts";
import { createAppointmentActions } from "./appointments";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createChapterActions } from "./chapters";
import { createMessenger, type Message } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { createCronRoute, CRON_JOBS } from "./cron";
import { createDashboard } from "./dashboard";
import { createEventActions } from "./events";
import { createGalleryActions } from "./gallery";
import { getAdminEnv, getAppUrls } from "./env";
import { createImageUploads } from "./images";
import { createMessageActions } from "./messaging";
import { createNewsletterActions } from "./newsletter";
import { createNewsActions } from "./news";
import { createOrgUnitActions } from "./org-units";
import { createPeriodActions } from "./periods";
import { createRoleActions } from "./roles";
import { createUniversityActions } from "./universities";
import { adminStores, imageStorage } from "./stores";

/** Role Manager actions with the real stores (server actions call these). */
export const accountActions = lazyEnv(() =>
  createAccountActions({
    ...adminStores(),
    sendInvite: (invite, roleName) =>
      messenger().send(
        inviteMessage(invite.email, roleName, getAppUrls().WEB_URL ?? ""),
        `invite:${inviteId(invite.email)}:${invite.version}`,
      ),
  }),
);

/** The e-mail of Role Manager → Add New People for an address without an account. */
function inviteMessage(to: string, roleName: string, webUrl: string): Message {
  const login = `${webUrl}/login`;
  const body =
    `Anda diundang ke admin PPI Dunia Kawasan Asia-Oseania sebagai ${roleName}. Masuk dengan ` +
    `alamat e-mail ini (Google atau e-mail dan kata sandi). / You are invited to the PPI Dunia ` +
    `Kawasan Asia-Oseania admin as ${roleName}. Sign in with this e-mail address (Google or ` +
    `e-mail and password).`;
  const staff =
    "Peran pengurus butuh dua metode masuk: setelah masuk pertama kali, tambahkan passkey di Akun " +
    "Anda lalu masuk lagi. / Staff roles need two sign-in methods: after the first sign-in, add " +
    "a passkey under Your account and sign in again.";
  return {
    channel: "email",
    to,
    subject: "Undangan admin PPIDK Asia-Oseania / PPIDK Asia-Oseania admin invitation",
    text: `${body}\n\n${login}\n\n${staff}`,
    html: `<p>${body}</p><p><a href="${login}">Masuk / Sign in</a></p><p>${staff}</p>`,
  };
}
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
  listRoleHolders: (roleIds: readonly string[], chapterIds?: readonly string[]) =>
    adminStores().accounts.listRoleHolders(roleIds, chapterIds),
  listInvites: () => adminStores().accounts.listInvites(),
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
  listAlbums: () => adminStores().galleries.listForAdmin(),
  listChapters: () => adminStores().chapters.listForAdmin(),
  listPeriods: () => adminStores().periods.listForAdmin(),
  getPeriod: (id: string) => adminStores().periods.get(id),
  listOrgUnits: (periodId: string) => adminStores().orgUnits.listForPeriod(periodId),
  getOrgUnit: (id: string) => adminStores().orgUnits.get(id),
  listAppointments: (periodId: string) => adminStores().appointments.listForPeriod(periodId),
  getAppointmentRoleMap: () => adminStores().appointments.getRoleMap(),
  listPendingUniversities: () => adminStores().universities.listPending(),
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
