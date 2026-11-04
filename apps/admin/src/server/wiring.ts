import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hasTwoSignInMethods } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import {
  deleteExpired,
  inviteId,
  type AuditListQuery,
  type SqlFormStore,
  type LetterListQuery,
} from "@website/db/sql";
import { CERTIFICATE_EMAIL_PURPOSE, type Letter } from "@website/domain/documents";
import { orgUnitPath } from "@website/domain/organizations";
import sharp from "sharp";
import { trackingLinkData, unsubscribeLinkData } from "@website/domain/newsletter";
import { logSecurityEvent } from "@website/observability";
import { keyedHash, signLink } from "@website/security";
import { createAccountActions } from "./accounts";
import { createApplicationActions } from "./applications";
import { createAppointmentActions } from "./appointments";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createChapterActions } from "./chapters";
import { createMessenger, type Message } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { createCronRoute, CRON_JOBS } from "./cron";
import { createDashboard } from "./dashboard";
import { createEventActions } from "./events";
import { createFormActions } from "./forms";
import { createGalleryActions } from "./gallery";
import { getAdminEnv, getAppUrls } from "./env";
import { createImageUploads } from "./images";
import { createIncomingActions } from "./incoming";
import { createInterviewActions } from "./interviews";
import { createLetterActions } from "./letters";
import {
  createCertificateActions,
  createCertificateFileRoute,
  createCertificatePickupRoute,
} from "./certificates";
import { createLetterFileRoute, createLetterPdf, type LetterContext } from "./letter-pdf";
import { createMessageActions } from "./messaging";
import { createNotices } from "./notices";
import { wahaChannel } from "./whatsapp";
import { createNewsletterActions } from "./newsletter";
import { createNewsActions } from "./news";
import { createOrgUnitActions } from "./org-units";
import { createPeriodActions } from "./periods";
import { createRecruitmentActions } from "./recruitment";
import { createRoleActions } from "./roles";
import { createUniversityActions } from "./universities";
import { adminDb, adminStores, imageStorage } from "./stores";
import { createOkrActions } from "./okr";
import { createProgramActions } from "./programs";

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

/** Incoming letters page (D6): agenda book, scans, dispositions. */
export const incomingActions = lazyEnv(() =>
  createIncomingActions({
    letters: adminStores().incoming,
    unitPeriod: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit && !unit.deletedAt ? unit.periodId : null;
    },
    userExists: async (uid) => (await adminStores().accounts.get(uid)) !== null,
    storage: imageStorage(),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** Letter PDFs (D9): rendering and the private archive. */
export const letterPdf = lazyEnv(() => {
  const env = getAdminEnv();
  return createLetterPdf({
    storage: imageStorage(),
    letters: adminStores().letters,
    toPng: async (bytes) => new Uint8Array(await sharp(bytes).png().toBuffer()),
    verification: { host: env.VERIFICATION_HOST ?? null, webUrl: env.WEB_URL ?? null },
    uuid: randomUUID,
    signatures: adminStores().signatures,
    signatureKey: () => env.FIELD_ENCRYPTION_KEY ?? null,
  });
});

/** What rendering a letter needs: its type, unit, period, the desks' names, the letterhead. */
export async function letterContext(
  letter: Letter,
): Promise<{ context: LetterContext; period: string | null } | null> {
  const stores = adminStores();
  const uids = [letter.secretary?.uid, letter.coordinator?.uid].filter((u): u is string => !!u);
  const [type, unit, period, people, settings] = await Promise.all([
    stores.letterTypes.get(letter.typeId),
    stores.orgUnits.get(letter.orgUnitId),
    stores.periods.get(letter.periodId),
    stores.accounts.getMany(uids),
    stores.letterSettings.get(),
  ]);
  if (!type) return null;
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  return {
    context: { type, unitName: unit?.name ?? "", names, letterhead: settings.letterhead },
    period: period?.name ?? null,
  };
}

/** GET /api/letters/<id>/pdf (src/app/api/letters/[id]/pdf/route.ts). */
export const letterFile = lazyEnv(() =>
  createLetterFileRoute({
    getLetter: (id) => adminStores().letters.get(id),
    load: letterContext,
    pdf: letterPdf(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

/** Certificate batches (D5): participants (pasted lists, removals). */
export const certificateActions = lazyEnv(() =>
  createCertificateActions({
    certificates: adminStores().certificates,
    getLetter: (id) => adminStores().letters.get(id),
    // Only a pasted e-mail column needs it (the same secret as apps/web, for the pickup page).
    hashEmail: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required for e-mail columns.");
      return keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, secret);
    },
    now: () => new Date(),
  }),
);

/** GET /api/letters/<id>/certificates/<sheetId> (one sheet, rendered on demand). */
export const certificateFile = lazyEnv(() =>
  createCertificateFileRoute({
    getLetter: (id) => adminStores().letters.get(id),
    getSheet: (id) => adminStores().certificates.get(id),
    load: letterContext,
    pdf: letterPdf(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

/** GET /certificates/pickup?t=… (D5-P): the link signed by the website's pickup page. */
export const certificatePickupFile = lazyEnv(() =>
  createCertificatePickupRoute({
    find: (code) => adminStores().verification.find(code),
    load: letterContext,
    pdf: letterPdf(),
    secret: () => getAdminEnv().LINK_SIGNING_SECRET ?? null,
    now: () => new Date(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

/** Letters page (D1, D2): drafts, desks, issue; Letter types page and letterhead. */
export const letterActions = lazyEnv(() =>
  createLetterActions({
    letters: adminStores().letters,
    types: adminStores().letterTypes,
    settings: adminStores().letterSettings,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    // The archive is made right after issue; if that fails the preview route makes it later.
    afterIssue: async (letter) => {
      try {
        const loaded = await letterContext(letter);
        if (loaded) await letterPdf().archive(letter, loaded.context, loaded.period);
      } catch (error) {
        adminStores().logger.error("letter archive failed", {
          letterId: letter.id,
          error: String(error),
        });
      }
    },
    storage: imageStorage(),
    files: letterPdf(),
    afterStep: (letter) => notices().letter(letter),
    now: () => new Date(),
    uuid: randomUUID,
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
    notify: (application, title) => notices().application(application, title),
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
    jobs: {
      ...CRON_JOBS,
      "newsletter-send": () => newsletterActions().runBatch(),
      expire: () => deleteExpired(adminDb(), new Date()),
    },
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
      whatsapp: wahaChannel(
        env.WAHA_BASE_URL && env.WAHA_API_KEY
          ? { baseUrl: env.WAHA_BASE_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION }
          : null,
      ),
    },
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    now: () => new Date(),
  });
});
/** Notification sources (J2): applicants and letter desk holders, on their own channel. */
export const notices = lazyEnv(() =>
  createNotices({
    contacts: adminStores().contacts,
    send: (message, key) => messenger().send(message, key),
    letterType: (id) => adminStores().letterTypes.get(id),
    webUrl: getAppUrls().WEB_URL ?? "",
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

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

/** OKR page (E1): objectives, key results, the period's vision and mission. */
export const okrActions = lazyEnv(() =>
  createOkrActions({
    objectives: adminStores().objectives,
    periods: adminStores().periods,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

/** Programmes page (E2, E3): plans, approval, milestones, health, weekly check-ins. */
export const programActions = lazyEnv(() =>
  createProgramActions({
    programs: adminStores().programs,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    findUserId: async (email) => (await adminStores().accounts.findByEmail(email))?.uid ?? null,
    now: () => new Date(),
    uuid: randomUUID,
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
  listForms: () => adminStores().forms.listForAdmin(),
  listLetters: (query: LetterListQuery) => adminStores().letters.list(query),
  getLetter: (id: string) => adminStores().letters.get(id),
  listCertificates: (batchId: string) => adminStores().certificates.list(batchId),
  listLetterTypes: () => adminStores().letterTypes.list(),
  getLetterSettings: () => adminStores().letterSettings.get(),
  listIncoming: (periodId: string) => adminStores().incoming.list(periodId, 300),
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
  currentFormVersions: (forms: Parameters<SqlFormStore["currentVersions"]>[0]) =>
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
  listObjectives: (periodId: string) => adminStores().objectives.listForPeriod(periodId),
  listPrograms: (periodId: string) => adminStores().programs.listForPeriod(periodId),
  getProgram: (id: string) => adminStores().programs.get(id),
  listCheckins: (programId: string) => adminStores().programs.listCheckins(programId),
};
