import { z } from "zod";
import { safeText } from "@website/security/validation";
import type { EntityMeta } from "../shared";

export const UNIVERSITY_STATUSES = ["approved", "pending", "rejected"] as const;
export type UniversityStatus = (typeof UNIVERSITY_STATUSES)[number];

export interface University extends EntityMeta {
  readonly name: string;
  readonly normalizedName: string;
  readonly countryCode: string;
  readonly city: string | null;
  readonly website: string | null;
  readonly aliases: readonly string[];
  readonly aliasesNormalized: readonly string[];
  readonly rorId: string | null;
  readonly source: "ror" | "manual";
  readonly status: UniversityStatus;
  readonly submittedBy: string | null;
  readonly mergedInto: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}

const STOP_WORDS = new Set(["the", "of", "de", "da", "di", "dan", "and", "at"]);
const EXPANSIONS: Readonly<Record<string, string>> = {
  univ: "university",
  universiti: "university",
  universitas: "university",
  inst: "institute",
  institut: "institute",
  tech: "technology",
  teknologi: "technology",
};

export function normalizeUniversityName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !STOP_WORDS.has(word))
    .map((word) => EXPANSIONS[word] ?? word);
  return words.join(" ").slice(0, 255).trimEnd();
}

export function tidyUniversityName(name: string): string {
  const spaced = name.trim().replace(/\s+/g, " ");
  if (spaced !== spaced.toUpperCase() && spaced !== spaced.toLowerCase()) return spaced;
  const titled = spaced
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
    .replace(/\b(Of|The|And|De|Da|Di|Dan)\b/g, (word) => word.toLowerCase());
  return titled.charAt(0).toUpperCase() + titled.slice(1);
}

export const UniversityProposalSchema = z
  .object({
    name: safeText(200).pipe(z.string().min(3, "Enter the campus name.")),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code"),
    city: safeText(100, { allowEmpty: true }),
  })
  .strict();
export type UniversityProposal = z.infer<typeof UniversityProposalSchema>;

export interface UniversityImportRow {
  readonly id: string;
  readonly rorId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly countryCode: string;
  readonly city: string | null;
  readonly website: string | null;
  readonly aliases: string[];
  readonly aliasesNormalized: string[];
}

type RorName = { value?: unknown; types?: unknown };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function universityRowsFromRor(
  item: unknown,
  countries: ReadonlySet<string>,
): UniversityImportRow[] {
  if (!isRecord(item) || item["status"] !== "active" || typeof item["id"] !== "string") return [];
  if (!list(item["types"]).includes("education")) return [];
  const rorId = item["id"];
  const names = list(item["names"]).filter(isRecord) as RorName[];
  const display = names.find((n) => list(n.types).includes("ror_display")) ?? names[0];
  if (typeof display?.value !== "string" || display.value.trim() === "") return [];
  const name = display.value;
  const aliases = [
    ...new Set(
      names
        .map((n) => n.value)
        .filter((v): v is string => typeof v === "string" && v !== "" && v !== name),
    ),
  ];
  const site = list(item["links"]).find((l) => isRecord(l) && l["type"] === "website");
  const website = isRecord(site) && typeof site["value"] === "string" ? site["value"] : null;
  const rows = new Map<string, UniversityImportRow>();
  for (const location of list(item["locations"])) {
    const details = isRecord(location) ? location["geonames_details"] : null;
    const code = isRecord(details) ? details["country_code"] : null;
    if (typeof code !== "string" || !countries.has(code) || rows.has(code)) continue;
    const city = isRecord(details) && typeof details["name"] === "string" ? details["name"] : null;
    rows.set(code, {
      id: `${rorId.split("/").pop() ?? rorId}_${code}`,
      rorId,
      name,
      normalizedName: normalizeUniversityName(name),
      countryCode: code,
      city,
      website,
      aliases,
      aliasesNormalized: aliases.map(normalizeUniversityName),
    });
  }
  return [...rows.values()];
}

const GENERIC = new Set([
  "university",
  "institute",
  "college",
  "school",
  "daigaku",
  "sekolah",
  "tinggi",
  "national",
  "state",
]);
const distinctiveWords = (name: string) =>
  normalizeUniversityName(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

export function mergeCandidates<T extends { name: string; countryCode: string }>(
  proposal: { name: string; countryCode: string },
  approved: readonly T[],
): T[] {
  const words = new Set(distinctiveWords(proposal.name));
  if (words.size === 0) return [];
  return approved
    .filter(
      (u) =>
        u.countryCode === proposal.countryCode &&
        distinctiveWords(u.name).some((w) => words.has(w)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 15);
}
