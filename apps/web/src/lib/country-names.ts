import type { Language } from "@/i18n/dictionaries";

/**
 * Reference data for the /map country list (design side.svg). A chapter's GROUP and
 * BADGE NUMBER come from the chapter's own data (`region`, `mapNo` — set by the admin,
 * so a new PPI shows with the next number without code); only the heading order is a
 * design constant here. Region headings are in the dictionaries (`map.regions`).
 */
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

/** The country's name in the page language ("Selandia Baru" / "New Zealand"); unknown codes stay as is. */
export function countryName(code: string, language: Language): string {
  return new Intl.DisplayNames([language], { type: "region", fallback: "code" }).of(code) ?? code;
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
