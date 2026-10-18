import "server-only";
import { randomUUID } from "node:crypto";
import { lazyEnv } from "@website/config/env";
import type { UserListQuery } from "@website/db";
import type { AuditListQuery } from "@website/db/firestore";
import { unsubscribeLinkData } from "@website/domain/newsletter";
import { logSecurityEvent } from "@website/observability";
import { signLink } from "@website/security";
import { createAccountActions } from "./accounts";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createChapterActions } from "./chapters";
import { createMessenger } from "@website/domain/messaging";
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
import { createRoleActions } from "./roles";
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
/**
 * Newsletter page actions and the "newsletter-send" cron job. Unsubscribe links need
 * LINK_SIGNING_SECRET (the same value as apps/web) and WEB_URL.
 */
export const newsletterActions = lazyEnv(() =>
  createNewsletterActions({
    campaigns: adminStores().campaigns,
    subscribers: adminStores().subscribers,
    send: (message, key) => messenger().send(message, key),
    unsubscribeUrl: (subscriberId) => {
      const secret = getAdminEnv().LINK_SIGNING_SECRET;
      const web = getAppUrls().WEB_URL;
      if (!secret || !web) throw new Error("LINK_SIGNING_SECRET and WEB_URL are required.");
      return `${web}/newsletter/unsubscribe?t=${signLink(unsubscribeLinkData(subscriberId), secret)}`;
    },
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
  }),
);

/** Reads for the admin pages. Callers check the page's `.read` permission first. */
export const adminReads = {
  listUsers: (query: UserListQuery) => adminStores().accounts.list(query),
  getUser: (uid: string) => adminStores().accounts.get(uid),
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
