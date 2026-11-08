import type { Language } from "@/i18n/dictionaries";

export type MapRegion = "oceania" | "southeastAsia" | "eastAsia" | "southAsia" | "middleAsia";

export const REGION_ORDER: readonly (MapRegion | "others")[] = [
  "oceania",
  "southeastAsia",
  "eastAsia",
  "southAsia",
  "middleAsia",
  "others",
];

export function countryName(code: string, language: Language): string {
  return new Intl.DisplayNames([language], { type: "region", fallback: "code" }).of(code) ?? code;
}

export const CHAPTER_MAP = "/map/countries/nz.png";

export function chapterAlias(name: string): string | null {
  return /^ppi\s+/i.test(name) ? null : name;
}
