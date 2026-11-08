import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { TimezoneSchema } from "../members/profile";
import { isValidSlug, RuleViolationError, type EntityMeta } from "../shared";

export interface Country extends EntityMeta {
  readonly code: string;
  readonly name: string;
}

export interface SocialLink {
  readonly label: string;
  readonly url: string;
}

export const CHAPTER_RISKS = ["none", "needs_checking", "at_risk"] as const;
export type ChapterRisk = (typeof CHAPTER_RISKS)[number];

export const CHAPTER_REGIONS = [
  "oceania",
  "southeastAsia",
  "eastAsia",
  "southAsia",
  "middleAsia",
  "others",
] as const;
export type ChapterRegion = (typeof CHAPTER_REGIONS)[number];

export interface Chapter extends EntityMeta {
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly region: ChapterRegion | null;
  readonly mapNo: number | null;
  readonly active: boolean;
  readonly timezone: string;
  readonly logo: FeaturedImage | null;
  readonly contactName: string;
  readonly contactPublic: string;
  readonly description: string;
  readonly role: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly email: string | null;
  readonly instagram: string | null;
  readonly socials: readonly SocialLink[];
  readonly latitude: number;
  readonly longitude: number;
  readonly memberCount: number;
  readonly conditions: readonly string[];
  readonly risk: ChapterRisk;
}

const ISO_ALPHA2 = /^[A-Z]{2}$/;
export function isValidCountryCode(code: string): boolean {
  return ISO_ALPHA2.test(code);
}

const optionalText = (max: number) => safeText(max, { allowEmpty: true });
const httpLink = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\/\S+$/i, "Use an http(s):// link.");
const optionalLink = z.union([z.literal(""), httpLink]).transform((v) => v || null);

export const ChapterInputSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(3, "Enter the chapter name.")),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isValidCountryCode, "Use the 2-letter ISO country code, e.g. JP."),
    region: z
      .union([z.enum(CHAPTER_REGIONS), z.literal("")])
      .default("")
      .transform((v) => v || null),
    mapNo: z
      .union([
        z
          .string()
          .trim()
          .regex(/^\d{1,3}$/, "Use a whole number, e.g. 18."),
        z.literal(""),
      ])
      .default("")
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().int().min(1).max(999).nullable()),
    timezone: TimezoneSchema,
    logo: FeaturedImageSchema.nullable(),
    contactName: optionalText(120),
    contactPublic: optionalText(200),
    description: optionalText(2000),
    role: optionalText(120).transform((v) => v || null),
    phone: optionalText(40).transform((v) => v || null),
    website: optionalLink,
    email: z
      .union([z.literal(""), z.email("Enter a valid e-mail address.").max(254)])
      .transform((v) => v || null),
    instagram: optionalText(100).transform((v) => v || null),
    socials: z
      .array(z.object({ label: safeText(40), url: httpLink }).strict())
      .max(5, "At most 5 other links."),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
    memberCount: z.number().int().min(0).max(1_000_000).default(0),
    conditions: z
      .array(safeText(160).pipe(z.string().min(2, "Write the condition or remove it.")))
      .max(5, "At most 5 conditions.")
      .default([]),
    risk: z.enum(CHAPTER_RISKS).default("none"),
  })
  .strict();
export type ChapterInput = z.infer<typeof ChapterInputSchema>;

export function mapPosition(latitude: number, longitude: number): { x: number; y: number } {
  const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value * 100) / 100));
  return { x: clamp(0.78094 * longitude - 46.762), y: clamp(57.991 - 0.71079 * latitude) };
}

export interface PublicChapter {
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly region: ChapterRegion | null;
  readonly mapNo: number | null;
  readonly active: boolean;
  readonly timezone: string;
  readonly logo: FeaturedImage | null;
  readonly contactName: string;
  readonly contactPublic: string;
  readonly description: string;
  readonly role: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly email: string | null;
  readonly instagram: string | null;
  readonly socials: readonly SocialLink[];
  readonly position: { x: number; y: number };
}

export function toPublicChapter(c: Chapter): PublicChapter {
  return {
    slug: c.slug,
    name: c.name,
    countryCode: c.countryCode,
    region: c.region,
    mapNo: c.mapNo,
    active: c.active,
    timezone: c.timezone,
    logo: c.logo,
    contactName: c.contactName,
    contactPublic: c.contactPublic,
    description: c.description,
    role: c.role,
    phone: c.phone,
    website: c.website,
    email: c.email,
    instagram: c.instagram,
    socials: c.socials,
    position: mapPosition(c.latitude, c.longitude),
  };
}

export interface ChapterReader {
  listActive(): Promise<Chapter[]>;
  findBySlug(slug: string): Promise<Chapter | null>;
}

export const PERIOD_STATUSES = ["draft", "active", "archived"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export interface Period extends EntityMeta {
  readonly name: string;
  readonly cabinet: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly vision: string;
  readonly mission: string;
  readonly lpjDeadlineDays: number;
  readonly status: PeriodStatus;
}

export function periodDatesFromName(name: string): { startsOn: string; endsOn: string } | null {
  const match = /^(\d{4})\s*[-/]\s*(\d{4})$/.exec(name.trim());
  if (!match || Number(match[2]) <= Number(match[1])) return null;
  return { startsOn: `${match[1]}-01-01`, endsOn: `${match[2]}-12-31` };
}

export const PeriodFormSchema = z
  .object({
    name: safeText(40).refine(
      (name) => periodDatesFromName(name) !== null,
      "Write the years of the period, e.g. 2026-2027.",
    ),
    cabinet: safeText(120).pipe(z.string().min(2, "Enter the cabinet name.")),
  })
  .strict();

export const canChangePeriod = (status: PeriodStatus): boolean => status !== "archived";
export const canDeletePeriod = (status: PeriodStatus): boolean => status !== "active";
export const canActivatePeriod = (status: PeriodStatus): boolean => status === "draft";

export const ORG_UNIT_TYPES = [
  "koordinator",
  "wakil_koordinator",
  "sekjen",
  "wasekjen",
  "bendahara",
  "wakil_bendahara",
  "direktorat",
  "biro",
  "bidang",
  "divisi",
  "staf",
] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

export const UnitMemberSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Enter the member's name.")),
    role: safeText(120).pipe(z.string().min(2, "Enter the member's role.")),
    head: z.boolean(),
    photo: FeaturedImageSchema.nullable(),
  })
  .strict();
export type UnitMember = z.infer<typeof UnitMemberSchema>;

export const UnitDivisionSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Enter the division name.")),
    members: z.array(UnitMemberSchema).max(50, "At most 50 members in a division."),
  })
  .strict();
export type UnitDivision = z.infer<typeof UnitDivisionSchema>;

export interface OrgUnit extends EntityMeta {
  readonly periodId: string;
  readonly parentId: string | null;
  readonly path: readonly string[];
  readonly name: string;
  readonly code: string;
  readonly type: OrgUnitType;
  readonly description: string;
  readonly sort: number;
  readonly active: boolean;
  readonly members: readonly UnitMember[];
  readonly divisions: readonly UnitDivision[];
}

export const unitPeopleCount = (unit: Pick<OrgUnit, "members" | "divisions">): number =>
  unit.members.length + unit.divisions.reduce((sum, d) => sum + d.members.length, 0);

export const OrgUnitInputSchema = z
  .object({
    periodId: safeId,
    parentId: safeId.nullable(),
    name: safeText(120).pipe(z.string().min(2, "Enter the unit name.")),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9](?:[A-Z0-9-]{0,15})$/, "Use up to 16 letters, numbers and dashes."),
    type: z.enum(ORG_UNIT_TYPES),
    description: safeText(2000, { multiline: true, allowEmpty: true }),
    sort: z.number().int().min(0).max(999),
    active: z.boolean(),
    members: z.array(UnitMemberSchema).max(50, "At most 50 core members.").default([]),
    divisions: z.array(UnitDivisionSchema).max(30, "At most 30 divisions.").default([]),
  })
  .strict();
export type OrgUnitInput = z.infer<typeof OrgUnitInputSchema>;

export const ORG_UNIT_MOVE_LIMIT = 400;

export const orgUnitPath = (unit: Pick<OrgUnit, "id" | "path">): string[] => [
  ...unit.path,
  unit.id,
];

export function placeOrgUnit(
  periodId: string,
  period: Pick<Period, "status"> | null,
  parentId: string | null,
  parent: OrgUnit | null,
): string[] {
  if (!period) throw new RuleViolationError("Choose a period first.");
  if (!canChangePeriod(period.status)) {
    throw new RuleViolationError("This period is archived; its structure can no longer change.");
  }
  if (parentId === null) return [];
  if (!parent || parent.deletedAt || parent.periodId !== periodId) {
    throw new RuleViolationError("The parent unit does not exist in this period.");
  }
  return orgUnitPath(parent);
}

export function assertNoCycle(unitId: string, parent: Pick<OrgUnit, "id" | "path"> | null): void {
  if (parent && orgUnitPath(parent).includes(unitId)) {
    throw new RuleViolationError("A unit cannot be moved inside itself or one of its units.");
  }
}

export const movedPath = (
  path: readonly string[],
  unitId: string,
  unitPath: readonly string[],
): string[] => [...unitPath, unitId, ...path.slice(path.indexOf(unitId) + 1)];

export function inTreeOrder<T extends Pick<OrgUnit, "id" | "parentId" | "sort" | "name">>(
  units: readonly T[],
): T[] {
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, T[]>();
  for (const unit of units) {
    const key = unit.parentId !== null && ids.has(unit.parentId) ? unit.parentId : null;
    children.set(key, [...(children.get(key) ?? []), unit]);
  }
  const ordered: T[] = [];
  const visit = (parentId: string | null) => {
    const siblings = [...(children.get(parentId) ?? [])].sort(
      (a, b) => a.sort - b.sort || a.name.localeCompare(b.name),
    );
    for (const unit of siblings) {
      ordered.push(unit);
      visit(unit.id);
    }
  };
  visit(null);
  return ordered;
}

export const APPOINTMENT_SEATS = ["head", "secretary", "member"] as const;
export type AppointmentSeat = (typeof APPOINTMENT_SEATS)[number];

export const CORE_UNIT_TYPES = [
  "koordinator",
  "wakil_koordinator",
  "sekjen",
  "wasekjen",
  "bendahara",
  "wakil_bendahara",
] as const satisfies readonly OrgUnitType[];
export type CoreUnitType = (typeof CORE_UNIT_TYPES)[number];
const isCoreUnit = (type: OrgUnitType): type is CoreUnitType =>
  (CORE_UNIT_TYPES as readonly OrgUnitType[]).includes(type);

export const AppointmentRoleMapSchema = z
  .object({
    officer: safeId,
    unitHead: safeId,
    unitSecretary: safeId,
    core: z.object(Object.fromEntries(CORE_UNIT_TYPES.map((t) => [t, safeId]))).strict(),
  })
  .strict();
export type AppointmentRoleMap = {
  readonly officer: string;
  readonly unitHead: string;
  readonly unitSecretary: string;
  readonly core: Readonly<Record<CoreUnitType, string>>;
};

export const SUGGESTED_APPOINTMENT_ROLES: AppointmentRoleMap = {
  officer: "officer",
  unitHead: "director",
  unitSecretary: "directorate_secretary",
  core: {
    koordinator: "coordinator",
    wakil_koordinator: "coordinator",
    sekjen: "secretary_general",
    wasekjen: "secretary_general",
    bendahara: "treasurer",
    wakil_bendahara: "treasurer",
  },
};

export const APPOINTMENT_STATUSES = ["active", "ended", "revoked"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment extends EntityMeta {
  readonly userId: string;
  readonly name: string;
  readonly periodId: string;
  readonly orgUnitId: string;
  readonly seat: AppointmentSeat;
  readonly title: string;
  readonly status: AppointmentStatus;
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export const AppointmentInputSchema = z
  .object({
    email: z.email("Enter the person's account e-mail.").max(254),
    orgUnitId: safeId,
    seat: z.enum(APPOINTMENT_SEATS),
    title: safeText(120).pipe(z.string().min(2, "Enter the title of the seat.")),
  })
  .strict();

export interface DerivedAssignment {
  readonly roleId: string;
  readonly scope:
    { readonly type: "global" } | { readonly type: "orgUnit"; readonly orgUnitId: string };
}

export function derivedAssignments(
  seat: AppointmentSeat,
  unit: Pick<OrgUnit, "id" | "type">,
  map: AppointmentRoleMap,
): DerivedAssignment[] {
  const officer: DerivedAssignment = { roleId: map.officer, scope: { type: "global" } };
  const forUnit = (roleId: string): DerivedAssignment => ({
    roleId,
    scope: { type: "orgUnit", orgUnitId: unit.id },
  });
  if (isCoreUnit(unit.type)) {
    return seat === "head"
      ? [officer, { roleId: map.core[unit.type], scope: { type: "global" } }]
      : [officer];
  }
  if (seat === "head") return [officer, forUnit(map.unitHead)];
  if (seat === "secretary") return [officer, forUnit(map.unitSecretary)];
  return [officer];
}
export * from "./chapter-records";
