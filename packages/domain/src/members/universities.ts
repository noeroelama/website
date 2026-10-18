import { z } from "zod";
import { safeText } from "@website/security/validation";
import type { EntityMeta } from "../shared";

/**
 * Universities master (feature A3), as in PPIDK: imported from the ROR dump (status approved)
 * or proposed by a member ("my campus is not listed", status pending until staff review it).
 * A duplicate proposal is merged into the existing campus (`mergedInto`), never deleted.
 */
export const UNIVERSITY_STATUSES = ["approved", "pending", "rejected"] as const;
export type UniversityStatus = (typeof UNIVERSITY_STATUSES)[number];

export interface University extends EntityMeta {
  readonly name: string;
  /** `normalizeUniversityName(name)`: finds obvious duplicates of a proposal. */
  readonly normalizedName: string;
  readonly countryCode: string;
  readonly city: string | null;
  readonly website: string | null;
  /** Other names from ROR (acronyms, local names), e.g. "UTokyo". */
  readonly aliases: readonly string[];
  readonly aliasesNormalized: readonly string[];
  /** e.g. https://ror.org/057zh3y96; null for a proposed campus. */
  readonly rorId: string | null;
  readonly source: "ror" | "manual";
  readonly status: UniversityStatus;
  readonly submittedBy: string | null;
  /** Set on a duplicate: the campus it was merged into. */
  readonly mergedInto: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}

/** Words that never tell two campuses apart. */
const STOP_WORDS = new Set(["the", "of", "de", "da", "di", "dan", "and", "at"]);
/** Common short forms, made equal to the long form. */
const EXPANSIONS: Readonly<Record<string, string>> = {
  univ: "university",
  universiti: "university",
  universitas: "university",
  inst: "institute",
  institut: "institute",
  tech: "technology",
  teknologi: "technology",
};

/**
 * Normalised name for duplicate detection, deliberately CONSERVATIVE (PPIDK DECISIONS §6): only
 * case, accents, punctuation, spacing, linking words and common short forms. Generic words such as
 * "national" stay, or "National University of Singapore" would collide with other campuses.
 */
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

/**
 * Tidies a proposed name mechanically: extra spaces, and ALL CAPS or all lower case become title
 * case (linking words stay lower case). Any other spelling is left as typed; the reviewer decides.
 */
export function tidyUniversityName(name: string): string {
  const spaced = name.trim().replace(/\s+/g, " ");
  if (spaced !== spaced.toUpperCase() && spaced !== spaced.toLowerCase()) return spaced;
  const titled = spaced
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
    .replace(/\b(Of|The|And|De|Da|Di|Dan)\b/g, (word) => word.toLowerCase());
  return titled.charAt(0).toUpperCase() + titled.slice(1);
}

/** A member's proposal of a campus that is not listed. */
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

/** One `universities/{id}` row from the ROR dump (the import script writes these). */
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

/**
 * One ROR v2 organisation → zero or more rows: active education organisations only, one row per
 * country of `countries` it has a location in, keyed `{rorKey}_{countryCode}` (DECISIONS §7b: an
 * organisation in two countries appears in both lists). Names come from `ror_display`.
 */
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

/** Words too common to hint at a duplicate (PPIDK CocokUniversitas). */
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

/**
 * Review queue hint: approved campuses of the same country sharing a distinctive word with the
 * proposal (at most 15, by name). The reviewer decides; nothing is merged automatically.
 */
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
