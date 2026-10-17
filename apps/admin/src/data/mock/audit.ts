/**
 * Audit-log admin mock data + helpers. Static, client-side only — there is no
 * audit read API in the admin app yet; the page manages its own state on top
 * of this seed, mirroring the semantics of `@website/audit` (AuditEvent rows:
 * actor, action, resourceType, before/after snapshots, revertible, 14-day
 * revert window). Rows mirror the Figma "AUDIT LOG ADMIN" screen: a banded
 * table with an expandable structured-diff row and a Revert action that
 * restores content — soft-deleted records are undeleted, and edits are
 * rolled back to their previous values — across events, gallery, articles,
 * newsletter and organizations.
 */

/** The five content kinds the audit log tracks (the page's entity tabs). */
export type AuditEntity = "event" | "gallery" | "article" | "newsletter" | "organization";

/** What an admin did to the record. */
export type AuditAction = "created" | "updated" | "deleted" | "reverted";

export interface AuditActor {
  /** Two-letter monogram shown in the small avatar. */
  initials: string;
  name: string;
  email: string;
}

/** One word of a diff value: unchanged ("plain"), removed (the old text —
 *  rendered red, struck through, on a red tint), or added (the new text —
 *  rendered white on a green background). */
export interface DiffPart {
  text: string;
  kind: "plain" | "removed" | "added";
}

/** Photo-change info for photo fields ("Photos", "Cover"): the Before/After
 *  strips show this many thumbnails, and the marked positions carry the
 *  badges — removed ones (1-based within the BEFORE strip) get a red ring
 *  with a − badge, added ones (1-based within the AFTER strip) a green ring
 *  with a + badge. */
export interface PhotoDelta {
  beforeCount: number;
  afterCount: number;
  removedIdx: number[];
  addedIdx: number[];
  /** Thumbnail URLs for each slot — Before shows beforeCount tiles, After the
   *  survivors of Before plus the added ones, reusing the gallery's own
   *  `/events/evNN.png` placeholder art so the strips look like real photos. */
  before: string[];
  after: string[];
}

/** One changed field inside the structured diff: before (previous value) → after. */
export interface AuditFieldChange {
  field: string;
  before: string;
  after: string;
  /** Snapshot clock of the old value (null when there was no previous state,
   *  e.g. a created record — its Before cell then shows only "—"). */
  beforeAt: string | null;
  /** Snapshot clock of the new value (the audit event's own moment). */
  afterAt: string | null;
  /** Rich rendering: word-level parts replacing the plain before/after
   *  strings (falls back to the strings when absent). */
  beforeParts?: DiffPart[];
  afterParts?: DiffPart[];
  /** Photo strip (gallery edits): renders thumbnail counts instead of text,
   *  with +/− badges on the changed photos. */
  photos?: PhotoDelta;
}

export interface AuditEntry {
  id: string;
  /** ISO timestamp of the change ("27 May 2026, 11:36"). */
  occurredAt: string;
  actor: AuditActor;
  action: AuditAction;
  entity: AuditEntity;
  /** Human-readable record title, e.g. "Simposium PPIDK Asia-Oseania 2026". */
  title: string;
  /** Short public-ish id shown muted, e.g. "#Qm2ve91L". */
  resourceId: string;
  /** 21-char operation id shown in the expanded detail, e.g. "8cHcylcPpkXO8jbJxgoP". */
  changeId: string;
  /** The diff shown when the row is expanded. */
  changes: AuditFieldChange[];
  /** True when this change can be undone within the 14-day window. Deleted
   *  records are soft-deleted and restorable (revert = undelete); updated
   *  records can be rolled back to their previous values. Creates carry side
   *  effects and are never revertible. */
  revertible: boolean;
  /** True once the admin has hit Revert on this row. */
  reverted: boolean;
  /** When the revert window closes (revertible rows only); drives "13 days left". */
  expiresAt: string | null;
}

export const AUDIT_ENTITY_LABELS: Readonly<Record<AuditEntity, string>> = {
  event: "Event",
  gallery: "Gallery",
  article: "Article",
  newsletter: "Newsletter",
  organization: "Organizations",
};

/** Date-range filter options shown in the calendar pill. */
export const AUDIT_RANGE_OPTIONS = [
  { key: "last7", label: "Last 7 days" },
  { key: "last14", label: "Last 14 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "all", label: "All time" },
] as const;
export type AuditRange = (typeof AUDIT_RANGE_OPTIONS)[number]["key"];

/** The action badge filter in the "Action" pill. */
export const AUDIT_ACTION_OPTIONS = [
  { key: "any", label: "Any" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "deleted", label: "Deleted" },
  { key: "reverted", label: "Reverted" },
] as const;
export type AuditActionFilter = (typeof AUDIT_ACTION_OPTIONS)[number]["key"];

/** Rows-per-page choices for the dark bar. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/* ==================================================================
   Seed helpers — deterministic "today" so the preview's relative
   stamps ("2h ago", "13 days left") and pagination stay stable,
   exactly like the organizations mock pins its BASE date.
   ================================================================== */

/** Mock "now": pinned so "Showing 1–10 of 112" holds across reloads. */
const BASE = Date.UTC(2026, 9, 17, 12, 0, 0);

/** Exported for the page's date-range filter to cut against the same clock. */
export const AUDIT_NOW = BASE;

/** ISO date string `days` days before BASE at `hour:minute`. */
function at(daysBefore: number, hour: number, minute = 0): string {
  const d = new Date(BASE - daysBefore * 86_400_000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** ISO string exactly `hours` before BASE (for recent rows). */
function hoursAgo(hours: number): string {
  return new Date(BASE - hours * 3_600_000).toISOString();
}

const ACTORS: ReadonlyArray<AuditActor> = [
  { initials: "NK", name: "Nevyllo K.", email: "nevyllo@example.org" },
  { initials: "AE", name: "Adhitia E.", email: "adhitia@example.org" },
  { initials: "SZ", name: "Salsabila Z.", email: "salsabila@example.org" },
  { initials: "SY", name: "System", email: "system@ppidk.asiania.id" },
];

/** Seven-character id shown under the title, e.g. "#Qm2ve91L". */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
/**
 * Scatter the (small, consecutive) row index across the whole alphabet with a
 * tiny LCG: a plain base conversion of e.g. `5` would degrade to codes like
 * "#BAAAAAA" (one varied character, all "A" fills). Stepping a full-width
 * 32-bit LCG before every digit keeps each position uniformly mixed, so codes
 * alternate uppercase, lowercase and digits.
 */
function shortId(seed: number): string {
  let x = (Math.imul(seed + 1, 2654435761) ^ 0x5bf03635) >>> 0;
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += ALPHABET[x % ALPHABET.length];
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  }
  return out;
}

/**
 * Long operation id for the expanded detail (like a Firestore document id):
 * 21 uniformly mixed characters, same LCG technique as shortId.
 */
function changeId(seed: number): string {
  let x = (Math.imul(seed + 1, 2654435761) ^ 0x2545f491) >>> 0;
  let out = "";
  for (let i = 0; i < 21; i++) {
    out += ALPHABET[x % ALPHABET.length];
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  }
  return out;
}

/** Per-entity record titles the seed rotates through. */
const TITLES: Readonly<Record<AuditEntity, readonly string[]>> = {
  event: [
    "Simposium PPIDK Asia-Oseania 2026",
    "Webinar Keterbukaan Informasi",
    "Roadshow Badan Koordinasi Kawasan",
    "Festival Digitalisasi Kawasan",
    "Lokakarya Data & Statistik Anggota",
  ],
  gallery: [
    "Dokumentasi Simposium 2026",
    "Album Webinar Keterbukaan Informasi",
    "Wisuda Thailand 2026",
    "Galeri Roadshow Lokasi",
    "Foto Festival Digitalisasi",
  ],
  article: [
    "Mencatat Sejarah Keterbukaan Informasi",
    "Riset Laporan Tahunan Anggota",
    "Profil Direktorat Pemberdayaan",
    "Analisis Data Keanggotaan",
    "Kolom Kolaborasi Lintas Negara",
  ],
  newsletter: [
    "Berita Berkala Edisi Mei 2026",
    "Flash News Kolaborasi Asiania",
    "Edisi Keterbukaan Informasi",
    "Buletin Digitalisasi Kawasan",
    "Ringkasan Inovasi Anggota",
  ],
  organization: [
    "Biro Organisasi",
    "Direktorat Pemberdayaan Daerah",
    "Biro Media & Komunikasi",
    "Direktorat Inovasi Digital",
    "Biro Keuangan & Aset",
  ],
};

/** The fields each entity keeps in its before/after diff snapshots. The first
 *  entry is the record's title-like field (Title/Headline/Subject/Name), the
 *  rest are ordinary changed fields. */
const FIELDS: Readonly<Record<AuditEntity, readonly string[]>> = {
  event: ["Title", "Status", "Date", "Location"],
  gallery: ["Title", "Photos"],
  article: ["Headline", "Status", "Category"],
  newsletter: ["Subject", "Status", "Recipients"],
  organization: ["Name", "Type", "Members"],
};

/** The word inserted into the title-like value on a record update — it is the
 *  thing that changed, so the After diff highlights it with a green background
 *  (e.g. "Wisuda Thailand 2026" → "Wisuda PPI Thailand 2026"). */
const INSERT_WORDS: Readonly<Record<AuditEntity, readonly string[]>> = {
  event: ["PPI", "Regional", "Digital"],
  gallery: ["Resmi", "Edisi", "PPI"], // gallery[2] = "PPI" → the pinned record 1 example
  article: ["Resmi", "Terbaru", "Eksklusif"],
  newsletter: ["Edisi", "Resmi", "Spesial"],
  organization: ["Baru", "Digital", "Nasional"],
};

/** Ordinary field values: every entry is an old → new pair plus the index of
 *  the word that is the change in the new value (rendered on green). Rows
 *  cycle through the variants so no two rows show the same before/after. */
type Pair = readonly [string, string, number];
const FIELD_PAIRS: Readonly<Record<string, readonly Pair[]>> = {
  Status: [
    ["Draft", "Published", 0],
    ["In Review", "Published", 0],
    ["Draft", "Scheduled", 0],
    ["Archived", "Public", 0],
  ],
  Category: [
    ["Policy", "Data & Innovation", 2],
    ["Media", "Kolaborasi Lintas Negara", 1],
    ["Riset", "Analisis Data Anggota", 1],
  ],
  Location: [
    ["Jakarta, ID", "Bali, ID", 0],
    ["Jakarta, ID", "Yogyakarta, ID", 0],
    ["Surabaya, ID", "Medan, ID", 0],
  ],
  Date: [
    ["27 May 2026", "15 Jun 2026", 0],
    ["18 Jul 2026", "22 Aug 2026", 0],
    ["03 Sep 2026", "17 Oct 2026", 0],
  ],
  Recipients: [
    ["120 subscribers", "132 subscribers", 0],
    ["480 subscribers", "502 subscribers", 0],
    ["1.2k subscribers", "1.3k subscribers", 0],
  ],
  Members: [
    ["24 members", "27 members", 0],
    ["31 members", "38 members", 0],
  ],
  Type: [
    ["Biro", "Direktorat", 0],
    ["Divisi", "Komite", 0],
    ["Bidang", "Subsidiary", 0],
  ],
};

const FALLBACK_PAIRS: readonly Pair[] = [["—", "Updated", 0]];

/** Pick the old → new pair for a field on one seeded row: rotate through the
 *  variants by the row's own counters so neighbouring rows differ. */
function pairFor(field: string, k: number): Pair {
  const set = FIELD_PAIRS[field] ?? FALLBACK_PAIRS;
  return set[k % set.length]!;
}

/** Split into word parts, all flagged as removed (red, struck, red tint). */
function removedParts(text: string): DiffPart[] {
  return text.split(" ").map((w) => ({ text: w, kind: "removed" }));
}

/** Split into word parts where exactly one index is the added (green) word. */
function addedParts(text: string, addedIdx: number): DiffPart[] {
  return text.split(" ").map((w, i) => ({ text: w, kind: i === addedIdx ? "added" : "plain" }));
}

/** Photo-delta templates — five shapes so the +/− caption isn't "+2 −1" on
 *  every record (1–3 added, 1–2 removed). Each row picks one by its counter
 *  (k+5); the pinned showcase row lands on scheme 1, exactly the design's
 *  4 → 5 photos, −1 at #2, +2 at #4/#5. Indexes are 1-based. */
type PhotoScheme = Pick<PhotoDelta, "beforeCount" | "afterCount" | "removedIdx" | "addedIdx">;
const PHOTO_SCHEMES: readonly PhotoScheme[] = [
  { beforeCount: 6, afterCount: 5, removedIdx: [2, 5], addedIdx: [5] }, // +1 −2
  { beforeCount: 4, afterCount: 5, removedIdx: [2], addedIdx: [4, 5] }, // +2 −1 ← pin
  { beforeCount: 5, afterCount: 5, removedIdx: [3], addedIdx: [5] }, // +1 −1
  { beforeCount: 5, afterCount: 7, removedIdx: [2], addedIdx: [5, 6, 7] }, // +3 −1
  { beforeCount: 6, afterCount: 6, removedIdx: [2, 4], addedIdx: [5, 6] }, // +2 −2
];

/** Photo-change spec for a Photos field: scheme picked by row counter (each
 *  slot carries a real thumbnail URL — the gallery's placeholder art — so the
 *  strips look like a photo album instead of numbered boxes). The surviving
 *  photos keep their order in the After strip, then the added ones appear at
 *  the tail with their green + badges. */
function photoDelta(titleIndex: number, k: number): PhotoDelta {
  const scheme = PHOTO_SCHEMES[(k + titleIndex + 3) % PHOTO_SCHEMES.length]!;
  const beforeCount = scheme.beforeCount;
  const afterCount = scheme.afterCount;
  const removedIdx = scheme.removedIdx;
  const addedIdx = scheme.addedIdx;
  const before = Array.from({ length: beforeCount }, (_, i) => evImage(k + i * 3 + titleIndex));
  const survivors = before.filter((_, i) => !removedIdx.includes(i + 1));
  const after = Array.from(
    { length: afterCount },
    (_, i) => survivors[i] ?? evImage(k + i * 7 + titleIndex),
  );
  return { beforeCount, afterCount, removedIdx, addedIdx, before, after };
}

/** One of the 50 local event placeholder images, e.g. "/events/ev12.png". The
 *  gallery page uses the same pool for its album covers. */
function evImage(seed: number): string {
  return `/events/ev${String((((seed % 50) + 50) % 50) + 1).padStart(2, "0")}.png`;
}

/** d-char hex-ish suffix for believable public ids. */
let seedCounter = 0;

/** Build one seeded log row. */
function row(
  daysBefore: number,
  hour: number,
  actorIndex: number,
  action: AuditAction,
  entity: AuditEntity,
  titleIndex: number,
  opts: { revertible?: boolean; reverted?: boolean; hours?: number } = {},
): AuditEntry {
  const id = `audit-${String(seedCounter++).padStart(4, "0")}`;
  const occurredAt = opts.hours !== undefined ? hoursAgo(opts.hours) : at(daysBefore, hour);
  // Row-diversity key: mixes the seed counters so each row picks a different
  // title edit shape, field pair and photo delta. The pinned showcase record
  // (0,9,0,"updated","gallery",2) lands on k = 6 → the insert-after-first-word
  // edit and the exact 4→5 photo change the design calls out.
  const k = daysBefore + actorIndex + titleIndex + 4;
  // Array index accesses are "unchecked" in this repo's strict config, so the
  // modulo lookups carry a definite `!` (the index is always in range).
  const title = TITLES[entity][titleIndex % TITLES[entity].length]!;
  // Deleted and updated records are both restorable within the 14-day window
  // (undelete / roll back to the previous values); creates are not.
  const revertible = opts.revertible ?? (action === "deleted" || action === "updated");
  const reverted = opts.reverted ?? false;
  // Snapshot clocks for the diff: the After stamp is the event's own moment;
  // the Before stamp is when the previous value was written — for a delete
  // that is the record's publish time (days earlier), for an update it is
  // the last change (hours earlier). Created records have no Before state.
  const occurred = new Date(occurredAt).getTime();
  const beforeDeltaMs =
    action === "deleted"
      ? 86_400_000 * (2 + ((titleIndex + daysBefore) % 5))
      : 3_600_000 * (2 + ((actorIndex + titleIndex) % 6));
  const beforeStamp =
    action === "created" ? null : new Date(occurred - beforeDeltaMs).toISOString();
  const afterStamp = occurredAt;
  const changes: AuditFieldChange[] = (() => {
    const isDeleted = action === "deleted";
    const isCreated = action === "created";
    // Title-like field (Title/Headline/Subject/Name) shows the record's own
    // old value; other ordinary fields get their pair from FIELD_PAIRS;
    // gallery Photos renders the photo strip.
    const titleField = FIELDS[entity][0]!;
    const others = FIELDS[entity].filter((f) => f !== titleField && f !== "Photos");
    const hasPhotos = FIELDS[entity].includes("Photos");
    // Not every row changes every ordinary field: drop 0–2 of them (left-mixed
    // by the row counter) so the field list scroll varies per record. The
    // pinned showcase (gallery) only has Photos, so it is unaffected.
    const drop = k % 3;
    const changedOthers =
      drop === 0
        ? others
        : drop === 1
          ? others.slice(0, Math.max(1, others.length - 1))
          : others.slice(1);
    // On an update a word is inserted into the title so the After side shows a
    // highlighted addition ("Wisuda Thailand 2026" → "Wisuda PPI Thailand 2026");
    // the inserted word's index marks it green in the rich diff. Rows vary the
    // edit so not every title change reads the same: insert after the first
    // word, append at the end, or swap one word for the insert word.
    const insertWord = INSERT_WORDS[entity][titleIndex % INSERT_WORDS[entity].length]!;
    const titleWords = title.split(" ");
    const editKind = k % 3; // 0: insert after 1st word, 1: append, 2: replace a word
    const at = editKind === 2 ? k % titleWords.length : editKind === 1 ? titleWords.length : 1;
    if (editKind === 2) {
      titleWords[at] = insertWord;
    } else {
      titleWords.splice(at, 0, insertWord);
    }
    const titleAddedIdx = at;
    const newTitle = titleWords.join(" ");

    const out: AuditFieldChange[] = [];
    const base = { beforeAt: isCreated ? null : beforeStamp, afterAt: afterStamp };
    if (isCreated) {
      out.push({ field: titleField, before: "—", after: newTitle, ...base });
    } else {
      out.push({
        field: titleField,
        before: title,
        after: isDeleted ? "" : newTitle,
        ...base,
        beforeParts: removedParts(title),
        ...(isDeleted ? {} : { afterParts: addedParts(newTitle, titleAddedIdx) }),
      });
    }
    for (const f of changedOthers) {
      const [before, after, addedIdx] = pairFor(f, k + others.indexOf(f));
      if (isCreated) {
        out.push({ field: f, before: "—", after, ...base });
      } else {
        out.push({
          field: f,
          before,
          after: isDeleted ? "" : after,
          ...base,
          beforeParts: removedParts(before),
          ...(isDeleted ? {} : { afterParts: addedParts(after, addedIdx) }),
        });
      }
    }
    if (hasPhotos) {
      if (isCreated) {
        // Created: no previous state, so the Before cell is "—" like every
        // created field on the other tabs, while the After cell shows the
        // album's actual photos (plain tiles without any +/− badge — nothing
        // was "changed", it is the initial state).

        const createdCount = [4, 6, 9, 12][k % 4]!;
        out.push({
          field: "Photos",
          before: "",
          after: "",
          ...base,
          photos: {
            beforeCount: 0,
            afterCount: createdCount,
            removedIdx: [],
            addedIdx: [],
            before: [],
            after: Array.from({ length: createdCount }, (_, i) => evImage(k + i * 7)),
          },
        });
      } else {
        out.push({
          field: "Photos",
          before: "",
          after: "",
          ...base,
          photos: photoDelta(titleIndex, k),
        });
      }
    }
    return out;
  })();

  return {
    id,
    occurredAt,
    actor: ACTORS[actorIndex % ACTORS.length]!,
    action: reverted ? "reverted" : action,
    entity,
    title,
    resourceId: `#${shortId(seedCounter + titleIndex)}`,
    changeId: changeId(seedCounter + titleIndex * 5 + actorIndex),
    changes,
    revertible: reverted ? false : revertible,
    reverted,
    expiresAt: revertible && !reverted ? at(daysBefore - 14, hour) : null,
  };
}

/* ==================================================================
   Seed: 112 rows within the last 7 days (so "Last 7 days" + 10/page →
   "Showing 1–10 of 112", exactly the Figma footer) plus a handful of
   older rows that only surface on "All time". Mostly deletions and
   updates, since the page's job is restoring reversible operations.
   ================================================================== */

const INITIAL: AuditEntry[] = [];

// 112 rows across the last 7 days: 16/day, spread across actors, entities
// and actions. Recent days carry the "2h ago"-style stamps.
for (let d = 0; d < 7; d++) {
  for (let i = 0; i < 16; i++) {
    const entity = (Object.keys(TITLES) as AuditEntity[])[i % 5]!;
    // Mix: mostly deleted/updated (both restorable — the actions this page
    // can roll back), some created (activity-only, never revertible), a few
    // already reverted.
    const action: AuditAction =
      (i * 7 + d) % 11 === 0
        ? "reverted"
        : (i * 7 + d) % 6 === 0
          ? "created"
          : (i * 7 + d) % 3 === 0
            ? "updated"
            : "deleted";
    const revertible = action === "deleted";
    const reverted = action === "reverted";
    const hour = 9 + ((i * 2) % 10);
    INITIAL.push(
      row(d, Math.min(hour, 21), i * 3 + d, action, entity, i + d * 3, {
        revertible,
        reverted,
        // Recent rows carry "Xh ago"-style stamps (day 0 only).
        ...(d === 0 ? { hours: i * 2 } : {}),
      }),
    );
  }
}

// Row 1 of the default view (occurredAt desc) is the seed's very first row.
// Pin it as an Updated Gallery — updated records are restorable too — with the
// showcase diff: Title "Wisuda Thailand 2026" → "Wisuda PPI Thailand 2026"
// (added "PPI" on green) and Photos 4 → 5 (−1 at #2, +2 at #4/#5).
INITIAL[0] = row(0, 9, 0, "updated", "gallery", 2, { hours: 0 });

// Older rows (beyond the 7-day pill): two per entity shipped outside the window.
const OLD_ACTIONS: readonly AuditAction[] = [
  "deleted",
  "updated",
  "created",
  "deleted",
  "reverted",
];
for (let i = 0; i < 8; i++) {
  const entity = (Object.keys(TITLES) as AuditEntity[])[i % 5]!;
  const action: AuditAction = OLD_ACTIONS[i % OLD_ACTIONS.length]!;
  INITIAL.push(
    row(25 + i * 9, 10 + (i % 8), i + 1, action, entity, i + 2, {
      revertible: false,
      reverted: action === "reverted",
    }),
  );
}

export const INITIAL_AUDIT: readonly AuditEntry[] = INITIAL;

/* ==================================================================
   Formatting helpers (kept here so the component stays presentation-only).
   ================================================================== */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO → "27 May 2026, 11:36". */
export function formatAuditDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

/** ISO → "just now" / "2h ago" / "3d ago" relative to the pinned BASE. */
export function timeAgo(iso: string): string {
  const diff = BASE - new Date(iso).getTime();
  if (diff < 60 * 60 * 1000) return "just now";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return `${days}d ago`;
}

/**
 * Whole days until the revert window closes, against the pinned BASE.
 * Returns 0 when the window already closed (kept at the 14-day boundary).
 */
export function daysLeft(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - BASE;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}
