/**
 * Organization admin mock data for the unit Structure screen and the Create/Edit Unit form
 * (Core Members + Divisions), until org units are stored (step 3.3). Static, client-side only.
 * Periods and PPI chapters come from Firestore.
 */

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

/** Rows-per-page options for the dark bar. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
