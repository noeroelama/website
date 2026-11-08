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

export function checkNumberPattern(pattern: string): string | null {
  const unknown = unknownToken(pattern);
  if (unknown !== undefined) return `Unknown placeholder {${unknown}}.`;
  return pattern.includes("{nomor}") ? null : "The pattern needs {nomor}.";
}

export interface NumberValues {
  readonly seq: number;
  readonly padding: number;
  readonly sheet?: number;
  readonly typeCode: string;
  readonly unitCode: string | null;
  readonly activityCode: string | null;
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
