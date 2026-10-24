/**
 * Letter numbers (D1, D5, D6), ported from PPIDK `LetterNumberService`. The placeholders keep
 * PPIDK's names so imported letter types number exactly as before:
 *
 *   {nomor}          sequence number, padded            007 (certificate sheets: 007.037)
 *   {jenis}          letter type code                   UND
 *   {unit}           issuing unit code ("PPIDK" if none) SEKJEN
 *   {bulan_romawi}   month of the letter date, Roman    VIII
 *   {bulan}          month, two digits                  08
 *   {tahun}          year                               2026
 *   {tahun_pendek}   last two digits of the year        26
 *   {kode_kegiatan}  activity code of a batch           LKMM
 *
 * Unlike PPIDK an unknown placeholder is refused (when the type is saved, and again here): a
 * number that has been printed can never be corrected.
 */
export const NUMBER_TOKENS = [
  "nomor",
  "jenis",
  "unit",
  "bulan_romawi",
  "bulan",
  "tahun",
  "tahun_pendek",
  "kode_kegiatan",
] as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export const romanMonth = (month: number) => ROMAN[month - 1] as string;

const TOKEN = /\{([^{}]*)\}/g;

const unknownToken = (pattern: string) =>
  [...pattern.matchAll(TOKEN)]
    .map(([, name]) => name as string)
    .find((name) => !(NUMBER_TOKENS as readonly string[]).includes(name));

/** Why a pattern cannot be used, or null. */
export function checkNumberPattern(pattern: string): string | null {
  const unknown = unknownToken(pattern);
  if (unknown !== undefined) return `Unknown placeholder {${unknown}}.`;
  return pattern.includes("{nomor}") ? null : "The pattern needs {nomor}.";
}

export interface NumberValues {
  readonly seq: number;
  /** Digits of {nomor} (PPIDK `number_padding`). */
  readonly padding: number;
  /** Sheet number inside a certificate batch: {nomor} becomes `007.037`. */
  readonly sheet?: number;
  readonly typeCode: string;
  readonly unitCode: string | null;
  readonly activityCode: string | null;
  /** The letter date, "YYYY-MM-DD". */
  readonly date: string;
}

export function formatNumber(pattern: string, values: NumberValues): string {
  const unknown = unknownToken(pattern);
  if (unknown !== undefined) throw new Error(`Unknown placeholder {${unknown}}.`);
  const pad = (n: number) => String(n).padStart(values.padding, "0");
  const [year, month] = values.date.split("-") as [string, string];
  const replacements: Record<(typeof NUMBER_TOKENS)[number], string> = {
    nomor: values.sheet === undefined ? pad(values.seq) : `${pad(values.seq)}.${pad(values.sheet)}`,
    jenis: values.typeCode.trim(),
    unit: values.unitCode?.trim() || "PPIDK",
    bulan_romawi: romanMonth(Number(month)),
    bulan: month,
    tahun: year,
    tahun_pendek: year.slice(2),
    kode_kegiatan: (values.activityCode ?? "").trim().toUpperCase(),
  };
  return pattern.replace(TOKEN, (_, name: keyof typeof replacements) => replacements[name]);
}
