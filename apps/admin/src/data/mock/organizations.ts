/**
 * Organization admin mock data + helpers. Static, client-side only — there is
 * no organization backend yet; the page manages its own state on top of this
 * seed. Fields mirror the Figma "ORGANIZATIONS ADMIN" screens: the Period
 * table, the unit Structure table, the Create/Edit Unit form (Core Members +
 * Divisions), and the PPI chapters table.
 */

export type PeriodStatus = "published" | "private" | "draft";

export interface PeriodItem {
  id: string;
  /** Period label, e.g. "2026-2027". */
  name: string;
  /** Name of the cabinet, e.g. "Kolaborasi Asiania". */
  cabinet: string;
  status: PeriodStatus;
  /** ISO created/modified date. */
  createdAt: string;
  updatedBy: string;
}

/** Unit codes the structure table groups by (Figma rows: Koor, Biro, …). */
export const UNIT_TYPES = ["Koor", "Biro", "Direktorat"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export interface UnitMember {
  id: string;
  name: string;
  role: string;
  /** Optional portrait data-URL (uploaded in the unit form). */
  photo: string | null;
  /** Previous role while the member is crowned "Kepala Direktorat", so the
   *  Head button can restore it when un-crowned. Null when not crowned. */
  previousRole: string | null;
}

export interface Division {
  id: string;
  /** Full division name, e.g. "Bidang Minat dan Bakat". */
  name: string;
  /** Each division runs its own team (Ketua, Wakil, Sekretaris, Staff…) —
   *  separate from the unit's core members (Kepala/Wakil/Sekretaris). */
  members: UnitMember[];
}

export interface UnitItem {
  id: string;
  /** Short type code shown large on the structure row, e.g. "Koor". */
  code: UnitType;
  /** Full unit name, e.g. "Badan Koordinasi Kawasan". */
  name: string;
  /** Cabinet the unit belongs to within its period, e.g. "Kolaborasi Asiania". */
  cabinet: string;
  periodId: string;
  members: UnitMember[];
  divisions: Division[];
}

export type PpiStatus = "published" | "private" | "draft";
export type PpiTab = "all" | "upcoming";

export interface PpiItem {
  id: string;
  /** Chapter name, e.g. "PPI Australia". */
  name: string;
  /** PPI country / chapter seat, e.g. "Australia". */
  country: string;
  /** ISO-3166 alpha-3 country code shown as #AUS under the chapter name. */
  code: string;
  timezone: string;
  members: number;
  /** Free-text completeness note shown under the chapter's status chips. */
  notes: string;
  /** True when the chapter still needs work (its natural "upcoming" state). */
  incomplete: boolean;
  status: PpiStatus;
  /** ISO created/modified date. */
  createdAt: string;
}

/** ISO date → "11 May 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Mock "today": the seed is pinned so pagination stays stable in the preview. */
const BASE = Date.UTC(2026, 9, 15);
function daysFromNow(days: number): string {
  const d = new Date(BASE + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/* ==================================================================
   Periods — the top-level list ("Organizations > Period"). Static
   seed of 12 rows so the darkbar "Showing 1–10 of N" paginates.
   ================================================================== */

const PERIOD_NAMES = [
  "2026-2027",
  "2025-2026",
  "2024-2025",
  "2023-2024",
  "2022-2023",
  "2021-2022",
  "2020-2021",
  "2019-2020",
  "2018-2019",
  "2017-2018",
  "2016-2017",
  "2015-2016",
] as const;

const CABINETS = [
  "Kolaborasi Asiania",
  "Sinergi Asia-Oseania",
  "Keterbukaan Informasi",
  "Digitalisasi Kawasan",
  "Inovasi Anggota",
  "Kolaborasi Lintas Negara",
  "Edukasi Publik",
  "Riset & Data",
  "Kemitraan Strategis",
  "Komunikasi Regional",
  "Pemberdayaan Anggota",
  "Transparansi Berkelanjutan",
] as const;

const AUTHORS = ["Nevyllo Kalangi", "Adhitia Erfina"] as const;

function periodsSeed(): PeriodItem[] {
  return PERIOD_NAMES.map((name, i) => {
    const status: PeriodStatus =
      i === 0 ? "published" : i % 3 === 0 ? "private" : i % 5 === 0 ? "draft" : "private";
    return {
      id: `per-${String(i + 1).padStart(2, "0")}`,
      name,
      cabinet: CABINETS[i]!,
      status,
      createdAt: daysFromNow(-7 - i * 41),
      updatedBy: AUTHORS[i % AUTHORS.length]!,
    };
  });
}

export const INITIAL_PERIODS: PeriodItem[] = periodsSeed();

/* ==================================================================
   Units — the structure table ("Organizations > Period > Structure").
   Rows show the unit code + people count; the edit button opens the
   unit form. Members/divisions live on the unit itself.
   ================================================================== */

export const PERIOD_2025 = "per-02";
export const PERIOD_LABELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "per-01", label: "Period 2026 / 2027" },
  { id: "per-02", label: "Period 2025 / 2026" },
  { id: "per-03", label: "Period 2024 / 2025" },
];

/** Cabinet per selectable period (falls back for periods created in-session). */
const PERIOD_CABINETS: Readonly<Record<string, string>> = {
  [PERIOD_LABELS[0]!.id]: "Kolaborasi Asiania",
  [PERIOD_2025]: "Sinergi Asia-Oseania",
  [PERIOD_LABELS[2]!.id]: "Keterbukaan Informasi",
};

/** Human names for the dummy core members, rotated across units. */
const MEMBER_NAMES = [
  "Nevyllo Zamuel Kalangi",
  "Adhitia Erfina",
  "Putri Maharani",
  "Rizky Ramadhan",
  "Salsabila Zahra",
  "Budi Santoso",
  "Dewi Lestari",
  "Fajar Nugroho",
  "Intan Permata Sari",
  "Andi Pratama",
  "Citra Ayu Lestari",
  "Dimas Aditya",
  "Eka Wulandari",
  "Gilang Ramadhan",
  "Hana Safitri",
  "Ilham Fauzi",
  "Jasmine Putri",
  "Kevin Wijaya",
  "Laila Nur Aini",
  "Muhammad Fikri",
  "Nabila Azzahra",
  "Oktavianus Manurung",
  "Putu Widiastuti",
  "Rayhan Hakim",
  "Siti Rahayu",
  "Taufik Hidayat",
  "Vina Anggraini",
  "Yoga Pratama",
  "Zainal Abidin",
  "Aisyah Rahmadani",
  "Bella Novitasari",
  "Candra Kirana",
  "Dika Pratama",
  "Elvira Marpaung",
  "Firdaus Ramadhan",
  "Gita Puspita",
  "Hendra Gunawan",
  "Indah Kurnia",
  "Joko Susilo",
  "Karina Maharani",
] as const;

/** Division names shown in the unit form, rotated across units. */
const DIVISION_NAMES = [
  "Divisi Keanggotaan",
  "Divisi Kaderisasi",
  "Divisi Publikasi",
  "Divisi Kreatif",
  "Divisi Program",
  "Divisi Operasional",
  "Divisi Hubungan Masyarakat",
  "Divisi Administrasi",
  "Divisi Keuangan",
  "Divisi Teknologi & Data",
  "Divisi Riset & Edukasi",
  "Divisi Advokasi & Hukum",
] as const;

/** Dummy units per selectable period: [periodId, name, code, members, divisions]. */
const UNIT_SEED: ReadonlyArray<readonly [string, string, UnitType, number, number]> = [
  // 2026-2027 / Kolaborasi Asiania
  [PERIOD_LABELS[0]!.id, "Badan Koordinasi Kawasan", "Koor", 4, 0],
  [PERIOD_LABELS[0]!.id, "Biro Organisasi", "Biro", 10, 2],
  [PERIOD_LABELS[0]!.id, "Biro Keuangan", "Biro", 8, 1],
  [PERIOD_LABELS[0]!.id, "Biro Media & Komunikasi", "Biro", 12, 2],
  [PERIOD_LABELS[0]!.id, "Biro Hukum & Advokasi", "Biro", 7, 1],
  [PERIOD_LABELS[0]!.id, "Biro Penelitian & Data", "Biro", 9, 2],
  [PERIOD_LABELS[0]!.id, "Direktorat Pemberdayaan Daerah", "Direktorat", 12, 2],
  [PERIOD_LABELS[0]!.id, "Direktorat Inovasi Digital", "Direktorat", 15, 2],
  [PERIOD_LABELS[0]!.id, "Direktorat Hubungan Internasional", "Direktorat", 11, 1],
  [PERIOD_LABELS[0]!.id, "Direktorat Pengembangan Sumber Daya", "Direktorat", 14, 2],
  // 2025-2026 / Sinergi Asia-Oseania
  [PERIOD_2025, "Badan Koordinasi Wilayah Nusantara", "Koor", 5, 0],
  [PERIOD_2025, "Biro Organisasi & Keanggotaan", "Biro", 11, 2],
  [PERIOD_2025, "Biro Advokasi & Hukum", "Biro", 9, 1],
  [PERIOD_2025, "Biro Keuangan & Aset", "Biro", 8, 2],
  [PERIOD_2025, "Biro Media & Informasi", "Biro", 13, 2],
  [PERIOD_2025, "Biro Riset & Strategi", "Biro", 10, 1],
  [PERIOD_2025, "Direktorat Kerja Sama Bilateral", "Direktorat", 10, 2],
  [PERIOD_2025, "Direktorat Komunikasi Publik", "Direktorat", 12, 2],
  [PERIOD_2025, "Direktorat Pendidikan Anggota", "Direktorat", 16, 2],
  [PERIOD_2025, "Direktorat Pemberdayaan Ekonomi", "Direktorat", 13, 1],
  // 2024-2025 / Keterbukaan Informasi
  [PERIOD_LABELS[2]!.id, "Badan Koordinasi Organisasi", "Koor", 6, 0],
  [PERIOD_LABELS[2]!.id, "Biro Administrasi & Umum", "Biro", 9, 2],
  [PERIOD_LABELS[2]!.id, "Biro Kaderisasi", "Biro", 7, 1],
  [PERIOD_LABELS[2]!.id, "Biro Hubungan Masyarakat", "Biro", 8, 2],
  [PERIOD_LABELS[2]!.id, "Biro Teknologi Informasi", "Biro", 11, 2],
  [PERIOD_LABELS[2]!.id, "Biro Keuangan", "Biro", 6, 1],
  [PERIOD_LABELS[2]!.id, "Direktorat Standarisasi Data", "Direktorat", 10, 2],
  [PERIOD_LABELS[2]!.id, "Direktorat Survei & Analisis", "Direktorat", 12, 1],
  [PERIOD_LABELS[2]!.id, "Direktorat Pelatihan & Edukasi", "Direktorat", 15, 2],
  [PERIOD_LABELS[2]!.id, "Direktorat Kemitraan", "Direktorat", 13, 2],
] as const;

function unitsSeed(): UnitItem[] {
  return UNIT_SEED.map(([periodId, name, code, memberCount, divisionCount], i) => ({
    id: `unit-${String(i + 1).padStart(2, "0")}`,
    code,
    name,
    cabinet: PERIOD_CABINETS[periodId] ?? "Kolaborasi Asiania",
    periodId,
    members: Array.from({ length: memberCount }, (_, m) => ({
      id: `m-${i}-${m}`,
      name: MEMBER_NAMES[(i * 7 + m) % MEMBER_NAMES.length]!,
      // First member leads the unit ("Kepala Direktorat" crowns the Head
      // button); the rest are ordinary staff.
      role: m === 0 ? "Kepala Direktorat" : "Staff",
      photo: null,
      previousRole: null,
    })),
    divisions: Array.from({ length: divisionCount }, (_, d) => ({
      id: `d-${i}-${d}`,
      name: DIVISION_NAMES[(i * 3 + d) % DIVISION_NAMES.length]!,
      members: Array.from({ length: 3 }, (_, m) => ({
        id: `dm-${i}-${d}-${m}`,
        name: MEMBER_NAMES[(i * 7 + d * 3 + m) % MEMBER_NAMES.length]!,
        // Divisions open with Ketua → Wakil → Sekretaris (rest Staff).
        role: ["Ketua", "Wakil", "Sekretaris"][m] ?? "Staff",
        photo: null,
        previousRole: null,
      })),
    })),
  }));
}

export const INITIAL_UNITS: UnitItem[] = unitsSeed();

/* ==================================================================
   PPI chapters — the second top-level tab ("Organizations > PPI").
   Each chapter rows its country, timezone, member count, completeness
   notes and two status chips; the tabs filter All vs Upcoming (rows
   whose data is still incomplete).
   ================================================================== */

export const PPI_TAB_LABELS: ReadonlyArray<{ key: PpiTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
];

const NOTES_INCOMPLETE =
  "Belum ada pengurus inti yang tercatat · Belum ada anggota yang terdaftar · Tidak ada satu pun kontak resmi";
const NOTES_COMPLETE = "Pengurus inti tercatat · Anggota terdaftar · Kontak resmi aktif";

const PPI_SEED: ReadonlyArray<[string, string, string, string, number, boolean]> = [
  // chapter, country, code, timezone, members, incomplete
  ["PPI Australia", "Australia", "AUS", "Australia/Sydney (UTC+10:00)", 200, true],
  ["PPI Jepang", "Jepang", "JPN", "Asia/Tokyo (UTC+09:00)", 156, false],
  ["PPI Korea", "Korea", "KOR", "Asia/Seoul (UTC+09:00)", 121, true],
  ["PPI Tiongkok", "Tiongkok", "CHN", "Asia/Shanghai (UTC+08:00)", 98, false],
  ["PPI Taiwan", "Taiwan", "TWN", "Asia/Taipei (UTC+08:00)", 74, true],
  ["PPI Hong Kong", "Hong Kong", "HKG", "Asia/Hong_Kong (UTC+08:00)", 66, false],
  ["PPI Singapura", "Singapura", "SGP", "Asia/Singapore (UTC+08:00)", 58, true],
  ["PPI Malaysia", "Malaysia", "MYS", "Asia/Kuala_Lumpur (UTC+08:00)", 47, false],
  ["PPI Thailand", "Thailand", "THA", "Asia/Bangkok (UTC+07:00)", 42, false],
  ["PPI Vietnam", "Vietnam", "VNM", "Asia/Ho_Chi_Minh (UTC+07:00)", 33, true],
  ["PPI Filipina", "Filipina", "PHL", "Asia/Manila (UTC+08:00)", 29, false],
  ["PPI Selandia Baru", "Selandia Baru", "NZL", "Pacific/Auckland (UTC+12:00)", 21, false],
];

function ppiSeed(): PpiItem[] {
  return PPI_SEED.map(([name, country, code, timezone, members, incomplete], i) => ({
    id: `ppi-${String(i + 1).padStart(2, "0")}`,
    name,
    country,
    code,
    timezone,
    members,
    notes: incomplete ? NOTES_INCOMPLETE : NOTES_COMPLETE,
    incomplete,
    status: i % 3 === 0 ? "published" : i % 3 === 1 ? "private" : "draft",
    createdAt: daysFromNow(-2 - i * 7),
  }));
}

export const INITIAL_PPIS: PpiItem[] = ppiSeed();

/** Rows-per-page options for the dark bar. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
