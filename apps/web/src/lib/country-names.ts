/**
 * Reference data for the /map country list, transcribed from the design (side.svg):
 * ISO 3166-1 alpha-2 → English display name, and the region headings. A chapter's
 * GROUP and BADGE NUMBER come from the chapter's own data (`region`, `mapNo` — set by
 * the admin, so a new PPI shows with the next number without code); only the heading
 * order is a design constant here. Unknown country codes fall back to the code itself
 * (still one row per chapter).
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AU: "Australia",
  BD: "Bangladesh",
  BN: "Brunei Darussalam",
  CN: "China",
  IN: "India",
  JP: "Japan",
  KG: "Kyrgyzstan",
  KR: "South Korea",
  KZ: "Kazakhstan",
  LK: "Sri Lanka",
  MY: "Malaysia",
  NP: "Nepal", // added for the dummy chapter demo (user); outside the design's 17
  NZ: "New Zealand",
  PH: "Phillippine", // spelling as in the design (user)
  SG: "Singapore",
  TH: "Thailand",
  TW: "Taiwan",
  VN: "Vietnam",
};

export type MapRegion = "oceania" | "southeastAsia" | "eastAsia" | "southAsia" | "middleAsia";

/** The design's region headings, in the design's order, then the "Others" group. */
export const REGION_ORDER: readonly (MapRegion | "others")[] = [
  "oceania",
  "southeastAsia",
  "eastAsia",
  "southAsia",
  "middleAsia",
  "others",
];

/** The design's region headings (English in both languages, like the page title). */
export const REGION_LABELS: Readonly<Record<MapRegion | "others", string>> = {
  oceania: "OCEANIA",
  southeastAsia: "SOUTH EAST ASIA",
  eastAsia: "EAST ASIA",
  southAsia: "SOUTH ASIA",
  middleAsia: "MIDDLE ASIA",
  others: "Others",
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

/**
 * The chapter detail page's LEFT image — the country's design map graphic. Only the
 * design's "New Zealand.png" exists, and EVERY chapter uses that map for now (user:
 * "Sementara untuk map nya gunakan map new Zealand saja"), copied to
 * `public/map/countries/nz.png` like the other design assets. The chapter PHOTO in
 * the panel is not an asset here — it comes from the chapter's own data, the admin
 * form's logo upload (user: "masuk ke database aja … semua foto dan deskripsi untuk
 * 17 negara ada di dashboard").
 */
export const CHAPTER_MAP = "/map/countries/nz.png";

/**
 * The alias shown next to the country in the table (PERPIKA, PERMITHA, PPIA, …):
 * the chapter name when it is a real acronym. Only names in the generic form
 * "PPI <country>" ("PPI Jepang", "PPI Malaysia", …) are left out — they would
 * repeat the country label. An acronym that simply starts with PPI ("PPIA") is
 * an alias too and IS shown (user: "jika nama aliasnya ada, harus muncul juga
 * di tabel Map"); the chapter keeps its alias as its name, e.g. the AU seed
 * chapter is named "PPIA".
 */
export function chapterAlias(name: string): string | null {
  return /^ppi\s+/i.test(name) ? null : name;
}
