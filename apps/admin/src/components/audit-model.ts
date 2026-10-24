import {
  REVERT_WINDOW_MS,
  type AuditAction,
  type AuditEvent,
  type JsonValue,
  type RevertDecision,
} from "@website/audit";
import { ADMIN_PAGES, type AdminPageId } from "@website/permissions";
import { AUDIT_ACTION_LABELS, label, REVERT_REJECTION_LABELS } from "../labels";
import type { Author } from "./authors";
import { esc } from "./format";

/**
 * What the Audit Log page shows, mapped on the server from `auditLogs/{id}`. The page loads the
 * entries of the chosen date range (at most `AUDIT_PAGE_LIMIT`) and filters, sorts and pages them
 * in the browser, like the Event page.
 */
export const AUDIT_PAGE_LIMIT = 500;

/** Date range picker (URL `?range=`); the server reads only this range. */
export const AUDIT_RANGES = {
  "1d": { label: "Last 24 hours", days: 1 },
  "7d": { label: "Last 7 days", days: 7 },
  "14d": { label: "Last 14 days", days: 14 },
  "30d": { label: "Last 30 days", days: 30 },
  all: { label: "All time", days: null },
} as const;
export type AuditRange = keyof typeof AUDIT_RANGES;

export function parseRange(value: string | undefined): AuditRange {
  return value !== undefined && Object.hasOwn(AUDIT_RANGES, value) ? (value as AuditRange) : "7d";
}

export function rangeStart(range: AuditRange, now: Date): Date | undefined {
  const days = AUDIT_RANGES[range].days;
  return days === null ? undefined : new Date(now.getTime() - days * 86_400_000);
}

/** Tabs: admin pages grouped as in the side panel (Organizations holds Period and Structure). */
export const AUDIT_TABS = {
  all: { label: "All", modules: null },
  events: { label: "Event", modules: ["events"] },
  gallery: { label: "Gallery", modules: ["gallery"] },
  articles: { label: "Article", modules: ["articles"] },
  newsletter: { label: "Newsletter", modules: ["newsletter"] },
  organizations: {
    label: "Organizations",
    modules: ["organizations", "periods", "structure", "appointments"],
  },
} as const satisfies Record<string, { label: string; modules: readonly AdminPageId[] | null }>;
export type AuditTab = keyof typeof AUDIT_TABS;

export function matchesTab(row: Pick<AuditRow, "module">, tab: AuditTab): boolean {
  const modules: readonly string[] | null = AUDIT_TABS[tab].modules;
  return modules === null || modules.includes(row.module);
}

/** One photo of an image field; `change` marks photos only on one side. */
export interface ImageCell {
  key: string;
  thumbUrl: string;
  change: "added" | "removed" | null;
}
export type FieldValue =
  { kind: "empty" } | { kind: "text"; text: string } | { kind: "images"; images: ImageCell[] };

export interface ChangeRow {
  field: string;
  label: string;
  before: FieldValue;
  after: FieldValue;
}

export interface AuditRow {
  id: string;
  /** ISO time of the change. */
  occurredAt: string;
  author: Author;
  action: AuditAction;
  actionLabel: string;
  /** Admin page id (`ADMIN_PAGES` key); the resource type for older entries. */
  module: string;
  moduleLabel: string;
  title: string;
  resourceId: string;
  /** Short record reference shown as "#Qm2ve9lL". */
  ref: string;
  /** ISO time of the record's previous change in the loaded list (Before header), or null. */
  previousAt: string | null;
  changes: ChangeRow[];
  revert: { allowed: true } | { allowed: false; reason: string };
  /** The stored entry as JSON (without request metadata or hashes). */
  raw: string;
}

/** Field labels the design names differently from the stored key. */
const FIELD_LABELS: Readonly<Record<string, string>> = { images: "Photos" };

/** "eventTitle" → "Event title". */
function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return FIELD_LABELS[field] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

type Image = { thumbUrl: string; path?: string; url?: string };
const isImage = (v: JsonValue | undefined): v is Image & { [key: string]: JsonValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && typeof v["thumbUrl"] === "string";
/** Image list of a value (one image, a list of images, or nothing); null = not an image field. */
function imagesOf(v: JsonValue | undefined): Image[] | null {
  if (isImage(v)) return [v];
  if (Array.isArray(v) && v.length > 0 && v.every(isImage)) return v;
  return null;
}
const imageKey = (i: Image) => i.path ?? i.url ?? i.thumbUrl;

function textOf(v: JsonValue | undefined): FieldValue {
  if (v === undefined) return { kind: "empty" };
  return { kind: "text", text: typeof v === "string" ? v : JSON.stringify(v) };
}

/** Before / After of one changed top-level field (unchanged fields are never stored). */
function changeOf(field: string, before: JsonValue | undefined, after: JsonValue | undefined) {
  const a = imagesOf(before);
  const b = imagesOf(after);
  const empty = (v: JsonValue | undefined) =>
    v === undefined || v === null || (Array.isArray(v) && v.length === 0);
  if ((a || empty(before)) && (b || empty(after)) && (a || b)) {
    const keysA = new Set((a ?? []).map(imageKey));
    const keysB = new Set((b ?? []).map(imageKey));
    const cells = (list: Image[] | null, other: Set<string>, change: "added" | "removed") =>
      (list ?? []).map((i) => ({
        key: imageKey(i),
        thumbUrl: i.thumbUrl,
        change: other.has(imageKey(i)) ? null : change,
      }));
    return {
      field,
      label: fieldLabel(field),
      before: { kind: "images", images: cells(a, keysB, "removed") },
      after: { kind: "images", images: cells(b, keysA, "added") },
    } satisfies ChangeRow;
  }
  return { field, label: fieldLabel(field), before: textOf(before), after: textOf(after) };
}

/** Server-side mapping to a table row (plain JSON for the client page). */
export function toAuditRow(
  entry: AuditEvent,
  author: Author,
  decision: RevertDecision,
  previousAt: Date | null,
): AuditRow {
  const page = entry.module ?? entry.resourceType;
  const fields = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ].sort();
  const { request, prevHash, hash, ...stored } = entry;
  void request;
  void prevHash;
  void hash;
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    author,
    action: entry.action,
    actionLabel: label(AUDIT_ACTION_LABELS, entry.action),
    module: page,
    moduleLabel: Object.hasOwn(ADMIN_PAGES, page) ? ADMIN_PAGES[page as AdminPageId].label : page,
    title: entry.title ?? entry.resourceId,
    resourceId: entry.resourceId,
    ref: entry.resourceId.slice(0, 8),
    previousAt: previousAt?.toISOString() ?? null,
    changes: fields.map((f) => changeOf(f, entry.before?.[f], entry.after?.[f])),
    revert: decision.allowed
      ? { allowed: true }
      : { allowed: false, reason: label(REVERT_REJECTION_LABELS, decision.reason) },
    raw: JSON.stringify(stored, null, 2),
  };
}

/** Entry id → time of the same record's previous change. `entries` are newest first. */
export function previousChanges(entries: readonly AuditEvent[]): Map<string, Date> {
  const previous = new Map<string, Date>();
  const older = new Map<string, Date>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as AuditEvent;
    const key = `${e.resourceType}/${e.resourceId}`;
    const before = older.get(key);
    if (before) previous.set(e.id, before);
    older.set(key, e.occurredAt);
  }
  return previous;
}

/** Whole days left in the 14-day revert window (rounded up). */
export function daysLeft(occurredAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(occurredAt) + REVERT_WINDOW_MS - now) / 86_400_000));
}

/** Word-level diff: `after` split into kept and added parts (longest common subsequence). */
export function wordDiff(before: string, after: string): { text: string; added: boolean }[] {
  const a = before.split(/(?<=\s)/).filter(Boolean);
  const b = after.split(/(?<=\s)/).filter(Boolean);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      const next = lcs[i + 1] as number[];
      row[j] =
        a[i]?.trim() === b[j]?.trim()
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const parts: { text: string; added: boolean }[] = [];
  const push = (text: string, added: boolean) => {
    const last = parts.at(-1);
    if (last && last.added === added) last.text += text;
    else parts.push({ text, added });
  };
  const same = (i: number, j: number) => a[i]?.trim() === b[j]?.trim();
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && same(i, j)) {
      push(b[j] as string, false);
      i++;
      j++;
    } else if (i < a.length && at(i + 1, j) >= at(i, j + 1)) {
      i++; // word removed from the old text
    } else {
      push(b[j] as string, true);
      j++;
    }
  }
  return parts;
}

/** Export CSV of the listed entries (cells already quoted for `downloadCsv`). */
export function auditCsv(rows: readonly AuditRow[]): string[][] {
  const header = ["Date (UTC)", "User", "E-mail", "Action", "Page", "Title", "Record", "Change ID"];
  return [
    [...header, "Fields"].map(esc),
    ...rows.map((r) =>
      [
        r.occurredAt.slice(0, 16).replace("T", " "),
        r.author.name,
        r.author.email,
        r.actionLabel,
        r.moduleLabel,
        r.title,
        r.resourceId,
        r.id,
        r.changes.map((c) => c.label).join("; "),
      ].map(esc),
    ),
  ];
}
