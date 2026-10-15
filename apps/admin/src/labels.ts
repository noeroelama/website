import {
  AUDIT_ACTIONS,
  REVERT_REJECTIONS,
  type AuditAction,
  type RevertRejection,
} from "@website/audit";
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

export const SCOPE_LABELS = {
  global: { id: "Semua cabang", en: "All chapters" },
  chapter: { id: "Cabang", en: "Chapter" },
} as const satisfies Record<"global" | "chapter", Label>;

export const ROLE_TYPE_LABELS = {
  builtIn: { id: "Bawaan", en: "Built-in" },
  custom: { id: "Kustom", en: "Custom" },
} as const satisfies Record<"builtIn" | "custom", Label>;

export const AUDIT_ACTION_LABELS = {
  CREATE: { id: "Buat", en: "Create" },
  UPDATE: { id: "Ubah", en: "Update" },
  DELETE: { id: "Hapus", en: "Delete" },
  PUBLISH: { id: "Terbitkan", en: "Publish" },
  UNPUBLISH: { id: "Batal terbit", en: "Unpublish" },
  SEND: { id: "Kirim", en: "Send" },
  UPLOAD: { id: "Unggah", en: "Upload" },
  REVERT: { id: "Kembalikan", en: "Revert" },
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

/** Every map with the keys it must cover (used by the completeness test). */
export const LABEL_MAPS: ReadonlyArray<{
  readonly name: string;
  readonly keys: readonly string[];
  readonly labels: Readonly<Record<string, Label>>;
}> = [
  { name: "user status", keys: ACCOUNT_STATUSES, labels: USER_STATUS_LABELS },
  { name: "scope", keys: ["global", "chapter"], labels: SCOPE_LABELS },
  { name: "role type", keys: ["builtIn", "custom"], labels: ROLE_TYPE_LABELS },
  { name: "audit action", keys: AUDIT_ACTIONS, labels: AUDIT_ACTION_LABELS },
  { name: "revert rejection", keys: REVERT_REJECTIONS, labels: REVERT_REJECTION_LABELS },
];

/** The admin is in English for now; pass "id" once the language switch exists. */
export function label<K extends string>(
  map: Readonly<Record<K, Label>>,
  key: K,
  language: Language = "en",
): string {
  return map[key][language];
}
