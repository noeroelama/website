import "server-only";
import { randomUUID } from "node:crypto";
import { lazyEnv } from "@website/config/env";
import type { UserListQuery } from "@website/db";
import type { AuditListQuery } from "@website/db/firestore";
import { logSecurityEvent } from "@website/observability";
import { createAccountActions } from "./accounts";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createMessenger } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { createCronRoute, CRON_JOBS } from "./cron";
import { createEventActions } from "./events";
import { getAdminEnv } from "./env";
import { createImageUploads } from "./images";
import { createMessageActions } from "./messaging";
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
    jobs: CRON_JOBS,
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
export const messageActions = lazyEnv(() => createMessageActions({ messenger: messenger() }));

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
