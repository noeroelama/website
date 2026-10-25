import {
  AUDIT_ACTIONS,
  REVERT_REJECTIONS,
  type AuditAction,
  type RevertRejection,
} from "@website/audit";
import { NEWS_CATEGORIES, type NewsCategory } from "@website/domain/content";
import { EVENT_TYPES, type EventType } from "@website/domain/events";
import { MESSAGE_STATUSES, type MessageStatus } from "@website/domain/messaging";
import {
  CHAPTER_RISKS,
  ORG_UNIT_TYPES,
  type ChapterRisk,
  type OrgUnitType,
} from "@website/domain/organizations";
import { ACCOUNT_STATUSES, type AccountStatus } from "@website/permissions";

/**
 * Display labels for stored keys, one map per module, in Indonesian and English. Keys stay in
 * the database; only labels are shown. `tests/unit/admin-labels.test.ts` fails when a key has
 * no label, so add the label in the same change as a new status, action or category.
 */
export type Label = { readonly id: string; readonly en: string };
export type Language = keyof Label;

export const USER_STATUS_LABELS = {
  active: { id: "Aktif", en: "Active" },
  inactive: { id: "Nonaktif", en: "Inactive" },
} as const satisfies Record<AccountStatus, Label>;

/** What happened (past tense): Audit Log badges and filter, dashboard "latest changes". */
export const AUDIT_ACTION_LABELS = {
  CREATE: { id: "Dibuat", en: "Created" },
  UPDATE: { id: "Diubah", en: "Updated" },
  DELETE: { id: "Dihapus", en: "Deleted" },
  PUBLISH: { id: "Diterbitkan", en: "Published" },
  UNPUBLISH: { id: "Batal terbit", en: "Unpublished" },
  SEND: { id: "Dikirim", en: "Sent" },
  UPLOAD: { id: "Diunggah", en: "Uploaded" },
  REVERT: { id: "Dikembalikan", en: "Reverted" },
} as const satisfies Record<AuditAction, Label>;

/** Why a REVERT button is disabled (tooltip) or a revert was refused. */
export const REVERT_REJECTION_LABELS = {
  window_expired: { id: "Batas waktu pengembalian sudah lewat", en: "Revert window expired" },
  already_reverted: { id: "Sudah dikembalikan", en: "Already reverted" },
  is_revert: { id: "Pengembalian tidak dapat dikembalikan", en: "A revert cannot be reverted" },
  version_conflict: {
    id: "Data sudah berubah setelah entri ini",
    en: "The record changed after this entry",
  },
  not_revertible: {
    id: "Perubahan ini tidak dapat dikembalikan (e-mail terkirim, unggahan, atau peran)",
    en: "This change cannot be reverted (e-mail sent, upload or role change)",
  },
} as const satisfies Record<RevertRejection, Label>;

export const MESSAGE_STATUS_LABELS = {
  queued: { id: "Dalam antrean", en: "Queued" },
  sent: { id: "Terkirim", en: "Sent" },
  failed: { id: "Gagal", en: "Failed" },
  skipped: { id: "Dilewati (tanpa alamat)", en: "Skipped (no address)" },
  logged: { id: "Hanya dicatat (mode log)", en: "Logged only (log mode)" },
  blocked: { id: "Diblokir (bukan penerima uji)", en: "Blocked (not a test recipient)" },
} as const satisfies Record<MessageStatus, Label>;

export const NEWS_CATEGORY_LABELS = {
  general: { id: "Umum", en: "General" },
  academic: { id: "Akademik", en: "Academic" },
  community: { id: "Komunitas", en: "Community" },
  announcement: { id: "Pengumuman", en: "Announcement" },
  international: { id: "Internasional", en: "International" },
} as const satisfies Record<NewsCategory, Label>;

export const EVENT_TYPE_LABELS = {
  general: { id: "Umum", en: "General" },
  seminar: { id: "Seminar", en: "Seminar" },
  webinar: { id: "Webinar", en: "Webinar" },
  discussion: { id: "Diskusi", en: "Discussion" },
  workshop: { id: "Lokakarya", en: "Workshop" },
  launch: { id: "Peluncuran", en: "Launch" },
  event: { id: "Acara", en: "Event" },
  festival: { id: "Festival", en: "Festival" },
  conference: { id: "Konferensi", en: "Conference" },
  exhibition: { id: "Pameran", en: "Exhibition" },
  meeting: { id: "Rapat", en: "Meeting" },
} as const satisfies Record<EventType, Label>;

export const ORG_UNIT_TYPE_LABELS = {
  koordinator: { id: "Koordinator", en: "Coordinator" },
  wakil_koordinator: { id: "Wakil Koordinator", en: "Deputy Coordinator" },
  sekjen: { id: "Sekretaris Jenderal", en: "Secretary General" },
  wasekjen: { id: "Wakil Sekretaris Jenderal", en: "Deputy Secretary General" },
  bendahara: { id: "Bendahara Umum", en: "Treasurer" },
  wakil_bendahara: { id: "Wakil Bendahara Umum", en: "Deputy Treasurer" },
  direktorat: { id: "Direktorat", en: "Directorate" },
  biro: { id: "Biro", en: "Bureau" },
  bidang: { id: "Bidang", en: "Field" },
  divisi: { id: "Divisi", en: "Division" },
  staf: { id: "Staf", en: "Staff" },
} as const satisfies Record<OrgUnitType, Label>;

/** Organizations → PPI status badge (the board's rating of a chapter). */
export const CHAPTER_RISK_LABELS = {
  none: { id: "Tidak ada risiko", en: "No risk" },
  needs_checking: { id: "Perlu dicek", en: "Needs checking" },
  at_risk: { id: "Berisiko kekosongan", en: "At risk of a vacuum" },
} as const satisfies Record<ChapterRisk, Label>;

/** Every map with the keys it must cover (used by the completeness test). */
export const LABEL_MAPS: ReadonlyArray<{
  readonly name: string;
  readonly keys: readonly string[];
  readonly labels: Readonly<Record<string, Label>>;
}> = [
  { name: "user status", keys: ACCOUNT_STATUSES, labels: USER_STATUS_LABELS },
  { name: "audit action", keys: AUDIT_ACTIONS, labels: AUDIT_ACTION_LABELS },
  { name: "revert rejection", keys: REVERT_REJECTIONS, labels: REVERT_REJECTION_LABELS },
  { name: "message status", keys: MESSAGE_STATUSES, labels: MESSAGE_STATUS_LABELS },
  { name: "news category", keys: NEWS_CATEGORIES, labels: NEWS_CATEGORY_LABELS },
  { name: "event type", keys: EVENT_TYPES, labels: EVENT_TYPE_LABELS },
  { name: "org unit type", keys: ORG_UNIT_TYPES, labels: ORG_UNIT_TYPE_LABELS },
  { name: "chapter risk", keys: CHAPTER_RISKS, labels: CHAPTER_RISK_LABELS },
];

/** The admin is in English for now; pass "id" once the language switch exists. */
export function label<K extends string>(
  map: Readonly<Record<K, Label>>,
  key: K,
  language: Language = "en",
): string {
  return map[key][language];
}
