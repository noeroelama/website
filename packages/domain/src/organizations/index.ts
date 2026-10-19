import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { TimezoneSchema } from "../members/profile";
import { isValidSlug, RuleViolationError, type EntityMeta } from "../shared";

export interface Country extends EntityMeta {
  readonly code: string; // ISO 3166-1 alpha-2
  readonly name: string;
}

export interface SocialLink {
  readonly label: string;
  readonly url: string;
}

/**
 * A member council (PPI Negara). Everything here is public: the contact person is stored only
 * with the contact details the chapter chose to publish. Deactivated, never deleted.
 */
export interface Chapter extends EntityMeta {
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly active: boolean;
  readonly timezone: string;
  readonly logo: FeaturedImage | null;
  readonly contactName: string;
  readonly contactPublic: string;
  readonly website: string | null;
  readonly email: string | null;
  readonly instagram: string | null;
  readonly socials: readonly SocialLink[];
  /** Map marker (e.g. the country's centre), WGS 84 degrees. */
  readonly latitude: number;
  readonly longitude: number;
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

/** The chapter form (admin Organizations → PPI). `active` changes only through deactivate/activate. */
export const ChapterInputSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(3, "Enter the chapter name.")),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isValidCountryCode, "Use the 2-letter ISO country code, e.g. JP."),
    timezone: TimezoneSchema,
    logo: FeaturedImageSchema.nullable(),
    contactName: optionalText(120),
    contactPublic: optionalText(200),
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
    /** Empty = built from the name. */
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
  })
  .strict();
export type ChapterInput = z.infer<typeof ChapterInputSchema>;

/**
 * Marker position on the Asia–Oceania dot map (`apps/web/public/map/asia-oceania.svg`, 616:720),
 * in percent of the box. The map is equirectangular; the constants are fitted to the reference
 * points of the PPIDK map (Astana, Tokyo, Wellington). Points outside the region stick to the edge.
 */
export function mapPosition(latitude: number, longitude: number): { x: number; y: number } {
  const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value * 100) / 100));
  return { x: clamp(0.78094 * longitude - 46.762), y: clamp(57.991 - 0.71079 * latitude) };
}

/** What visitors see of an active chapter (map card, member councils). */
export interface PublicChapter {
  readonly slug: string;
  readonly name: string;
  readonly countryCode: string;
  readonly timezone: string;
  readonly logo: FeaturedImage | null;
  readonly contactName: string;
  readonly contactPublic: string;
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
    timezone: c.timezone,
    logo: c.logo,
    contactName: c.contactName,
    contactPublic: c.contactPublic,
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

/* ---- Board periods (feature A1) ---- */

/** draft → active (one at a time) → archived (read-only). Periods are never deleted. */
export const PERIOD_STATUSES = ["draft", "active", "archived"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/** One board term (kepengurusan), e.g. 2026/2027. Dates are calendar days (YYYY-MM-DD). */
export interface Period extends EntityMeta {
  readonly name: string;
  /** Name of the cabinet, e.g. "Kolaborasi Asiania". */
  readonly cabinet: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly vision: string;
  readonly mission: string;
  /** Days after the end date by which the accountability report (LPJ) is due. */
  readonly lpjDeadlineDays: number;
  readonly status: PeriodStatus;
}

/** The period form fields. The status changes only through activation. */
export const PeriodInputSchema = z
  .object({
    name: safeText(40).pipe(z.string().min(4, "Enter the period, e.g. 2026/2027.")),
    cabinet: safeText(120, { allowEmpty: true }),
    startsOn: z.iso.date("Enter the start date."),
    endsOn: z.iso.date("Enter the end date."),
    vision: safeText(2000, { multiline: true, allowEmpty: true }),
    mission: safeText(4000, { multiline: true, allowEmpty: true }),
    lpjDeadlineDays: z.number().int().min(0).max(365),
  })
  .strict();
export type PeriodInput = z.infer<typeof PeriodInputSchema>;

/** The date-order rule, added after the form schema is extended (e.g. with id and version). */
export const withPeriodDates = <S extends z.ZodType<{ startsOn: string; endsOn: string }>>(
  schema: S,
) =>
  schema.refine((p) => p.endsOn > p.startsOn, {
    path: ["endsOn"],
    message: "The end date must be after the start date.",
  });

/** Archived periods are history: nothing about them changes any more. */
export const canChangePeriod = (status: PeriodStatus): boolean => status !== "archived";
/** Only a draft becomes the active period (an archived one never comes back). */
export const canActivatePeriod = (status: PeriodStatus): boolean => status === "draft";

/* ---- Organisation structure (feature A5) ---- */

/** Unit kinds, as in PPIDK (the names differ between periods: "Bidang" now, "Divisi" before). */
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

/**
 * One unit of a period's structure (bureau, directorate, division ...). `path` holds the ids of
 * its ancestors, root first, so "every unit below X" is one `path array-contains X` query.
 */
export interface OrgUnit extends EntityMeta {
  readonly periodId: string;
  readonly parentId: string | null;
  readonly path: readonly string[];
  readonly name: string;
  /** Short and unique within the period, e.g. MED or MED-DSN. */
  readonly code: string;
  readonly type: OrgUnitType;
  /** Tasks and functions (tupoksi). */
  readonly description: string;
  /** Order among its siblings. */
  readonly sort: number;
  readonly active: boolean;
}

/** The unit form. Where a unit sits (period, parent) is set on create and changed only by Move. */
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
  })
  .strict();
export type OrgUnitInput = z.infer<typeof OrgUnitInputSchema>;

/** At most this many units move at once (one Firestore transaction holds 500 writes). */
export const ORG_UNIT_MOVE_LIMIT = 400;

/** For `ResourceContext.orgUnitPath`: the unit's ancestors and the unit itself. */
export const orgUnitPath = (unit: Pick<OrgUnit, "id" | "path">): string[] => [
  ...unit.path,
  unit.id,
];

/**
 * Where a unit may sit: the parent must be a live unit of the same period, and the period must
 * not be archived. Returns the unit's ancestor path. Throws RuleViolationError otherwise.
 */
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

/** Refuses a move of `unitId` under `parent` that would put the unit inside itself. */
export function assertNoCycle(unitId: string, parent: Pick<OrgUnit, "id" | "path"> | null): void {
  if (parent && orgUnitPath(parent).includes(unitId)) {
    throw new RuleViolationError("A unit cannot be moved inside itself or one of its units.");
  }
}

/** A descendant's new path after its ancestor `unitId` moved to `unitPath`. */
export const movedPath = (
  path: readonly string[],
  unitId: string,
  unitPath: readonly string[],
): string[] => [...unitPath, unitId, ...path.slice(path.indexOf(unitId) + 1)];

/** Depth-first tree order (siblings by `sort`, then name), for lists and pickers. */
export function inTreeOrder<T extends Pick<OrgUnit, "id" | "parentId" | "sort" | "name">>(
  units: readonly T[],
): T[] {
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, T[]>();
  for (const unit of units) {
    // A unit whose parent is not in the list is shown at the top level.
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

/* ---- Appointments (feature B7) ---- */

/** Where someone sits in a unit: its head, its secretary, or a member. */
export const APPOINTMENT_SEATS = ["head", "secretary", "member"] as const;
export type AppointmentSeat = (typeof APPOINTMENT_SEATS)[number];

/** Units whose head acts for the whole organisation (their roles are global). */
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

/**
 * Which role an appointment gives (`settings/appointmentRoles`, data edited by staff with
 * roles.edit — not code): every officer, unit heads and secretaries (scoped to their unit and
 * the units below it), and the head of each core unit (global).
 */
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

/** The suggested mapping ("Use suggested mapping"), matching the admin's suggested roles. */
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

/** Someone appointed to a seat in a unit for one period. Ended, never deleted (history). */
export interface Appointment extends EntityMeta {
  readonly userId: string;
  /** The person's name (or e-mail) when appointed, for lists. */
  readonly name: string;
  readonly periodId: string;
  readonly orgUnitId: string;
  readonly seat: AppointmentSeat;
  /** What the seat is called, e.g. "Direktur Media". */
  readonly title: string;
  readonly status: AppointmentStatus;
  readonly startsOn: string;
  readonly endsOn: string | null;
}

/** The appoint form (admin Structure page). The person is found by the account's e-mail. */
export const AppointmentInputSchema = z
  .object({
    email: z.email("Enter the person's account e-mail.").max(254),
    orgUnitId: safeId,
    seat: z.enum(APPOINTMENT_SEATS),
    title: safeText(120).pipe(z.string().min(2, "Enter the title of the seat.")),
  })
  .strict();

/** One role an appointment gives: global, or for the unit (and everything below it). */
export interface DerivedAssignment {
  readonly roleId: string;
  readonly scope:
    { readonly type: "global" } | { readonly type: "orgUnit"; readonly orgUnitId: string };
}

/**
 * The roles an appointment gives (PPIDK PenugasanService): every officer gets the officer role;
 * the head of a core unit gets that unit's role globally; the head or secretary of another unit
 * gets the unit-head or unit-secretary role for that unit. Members get nothing more.
 */
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
