import {
  AUDIT_ACTIONS,
  REVERT_REJECTIONS,
  type AuditAction,
  type RevertRejection,
} from "@website/audit";
import { NEWS_CATEGORIES, type NewsCategory } from "@website/domain/content";
import { EVENT_TYPES, type EventType } from "@website/domain/events";
import {
  FORM_STATUSES,
  FORM_USAGES,
  QUESTION_TYPES,
  type FormStatus,
  type FormUsage,
  type QuestionType,
} from "@website/domain/forms";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@website/domain/recruitment";
import {
  DISPOSITION_STATUSES,
  INCOMING_STATUSES,
  LETTER_STATUSES,
  type DispositionStatus,
  type IncomingStatus,
  type LetterStatus,
} from "@website/domain/documents";
import { MESSAGE_STATUSES, type MessageStatus } from "@website/domain/messaging";
import {
  CHAPTER_REGIONS,
  CHAPTER_RISKS,
  ORG_UNIT_TYPES,
  type ChapterRegion,
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
  seminar: { id: "Seminar", en: "Seminar" },
  workshop: { id: "Workshop", en: "Workshop" },
  webinar: { id: "Webinar", en: "Webinar" },
  conference: { id: "Conference", en: "Conference" },
  meeting: { id: "Meetup", en: "Meetup" },
  other: { id: "Lainnya", en: "Other" },
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

/** Where the chapter sits on the /map country table (regions of the side.svg design). */
export const CHAPTER_REGION_LABELS = {
  oceania: { id: "Oseania", en: "Oceania" },
  southeastAsia: { id: "Asia Tenggara", en: "South East Asia" },
  eastAsia: { id: "Asia Timur", en: "East Asia" },
  southAsia: { id: "Asia Selatan", en: "South Asia" },
  middleAsia: { id: "Asia Tengah", en: "Middle Asia" },
  others: { id: "Lainnya", en: "Others" },
} as const satisfies Record<ChapterRegion, Label>;

export const FORM_USAGE_LABELS = {
  public: { id: "Formulir publik", en: "Public form" },
  recruitment: { id: "Formulir Oprec", en: "Recruitment form" },
} as const satisfies Record<FormUsage, Label>;

export const FORM_STATUS_LABELS = {
  draft: { id: "Draf", en: "Draft" },
  published: { id: "Dipublikasikan", en: "Published" },
  closed: { id: "Ditutup", en: "Closed" },
} as const satisfies Record<FormStatus, Label>;

export const QUESTION_TYPE_LABELS = {
  short_text: { id: "Jawaban singkat", en: "Short answer" },
  long_text: { id: "Paragraf", en: "Paragraph" },
  email: { id: "E-mail", en: "E-mail" },
  number: { id: "Angka", en: "Number" },
  date: { id: "Tanggal", en: "Date" },
  single_choice: { id: "Pilihan ganda", en: "Multiple choice (one)" },
  multi_choice: { id: "Kotak centang", en: "Checkboxes (several)" },
  file: { id: "Unggah berkas", en: "File upload" },
  consent: { id: "Persetujuan", en: "Consent" },
} as const satisfies Record<QuestionType, Label>;

export const APPLICATION_STATUS_LABELS = {
  draft: { id: "Draf", en: "Draft" },
  submitted: { id: "Terkirim", en: "Submitted" },
  revision: { id: "Perlu revisi", en: "Revision requested" },
  admin_rejected: { id: "Gugur administrasi", en: "Failed document check" },
  interview: { id: "Wawancara", en: "Interview" },
  offered: { id: "Ditawari", en: "Offered" },
  accepted: { id: "Menerima tawaran", en: "Accepted" },
  declined: { id: "Menolak tawaran", en: "Declined" },
  approved: { id: "Penempatan disetujui", en: "Placement approved" },
  pakta_review: { id: "Pakta diperiksa", en: "Pact in review" },
  confirmed: { id: "Dikukuhkan", en: "Confirmed" },
  rejected: { id: "Tidak lolos", en: "Rejected" },
  withdrawn: { id: "Mengundurkan diri", en: "Withdrawn" },
} as const satisfies Record<ApplicationStatus, Label>;

export const LETTER_STATUS_LABELS = {
  draft: { id: "Draf", en: "Draft" },
  review: { id: "Direview", en: "In review" },
  corrected: { id: "Terkoreksi", en: "Corrected (to sign)" },
  approved: { id: "Disetujui", en: "Approved (to issue)" },
  awaiting_file: { id: "Menunggu berkas", en: "Waiting for the file" },
  issued: { id: "Terbit", en: "Issued" },
  cancelled: { id: "Dibatalkan", en: "Cancelled" },
} as const satisfies Record<LetterStatus, Label>;

export const INCOMING_STATUS_LABELS = {
  new: { id: "Baru", en: "New" },
  disposed: { id: "Didisposisi", en: "Disposed" },
  done: { id: "Selesai", en: "Done" },
  archived: { id: "Arsip", en: "Archived" },
} as const satisfies Record<IncomingStatus, Label>;

export const DISPOSITION_STATUS_LABELS = {
  waiting: { id: "Menunggu", en: "Waiting" },
  in_progress: { id: "Diproses", en: "In progress (forwarded)" },
  done: { id: "Selesai", en: "Done" },
} as const satisfies Record<DispositionStatus, Label>;

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
  { name: "chapter region", keys: CHAPTER_REGIONS, labels: CHAPTER_REGION_LABELS },
  { name: "form usage", keys: FORM_USAGES, labels: FORM_USAGE_LABELS },
  { name: "form status", keys: FORM_STATUSES, labels: FORM_STATUS_LABELS },
  { name: "question type", keys: QUESTION_TYPES, labels: QUESTION_TYPE_LABELS },
  { name: "application status", keys: APPLICATION_STATUSES, labels: APPLICATION_STATUS_LABELS },
  { name: "letter status", keys: LETTER_STATUSES, labels: LETTER_STATUS_LABELS },
  { name: "incoming status", keys: INCOMING_STATUSES, labels: INCOMING_STATUS_LABELS },
  { name: "disposition status", keys: DISPOSITION_STATUSES, labels: DISPOSITION_STATUS_LABELS },
];

/** The admin is in English for now; pass "id" once the language switch exists. */
export function label<K extends string>(
  map: Readonly<Record<K, Label>>,
  key: K,
  language: Language = "en",
): string {
  return map[key][language];
}
