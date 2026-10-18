import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";

/**
 * Member profile — the personal data collected from every member/registrant.
 * Stored in Firestore at `memberProfiles/{uid}` (separate from `users/{uid}` so that
 * role checks and listings never load personal data).
 *
 * Personal data under Indonesia's UU PDP (Law 27/2022): collect only these fields,
 * with recorded consent, restricted access (`members.pii`) and audit redaction.
 */

export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

/** Indonesian level names in comments; stored values are stable English keys. */
export const EDUCATION_LEVELS = [
  "diploma", // D3 / D4
  "bachelor", // S1
  "master", // S2
  "doctoral", // S3
  "postdoctoral",
  "non_degree", // exchange, language school, short course
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Every free-text field is sanitized (Unicode-normalized, control characters removed, no HTML). */
const trimmed = (max: number) => safeText(max);

/** E.164, e.g. +6281234567890. WhatsApp and emergency numbers must include the country code. */
export const PhoneE164Schema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +6281234567890"));

const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code");

export const TimezoneSchema = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz.includes("/") || tz === "UTC";
    } catch {
      return false;
    }
  }, "IANA timezone, e.g. Asia/Tokyo");

export const AddressAbroadSchema = z
  .object({
    line1: trimmed(200),
    line2: trimmed(200).optional(),
    city: trimmed(100),
    stateOrProvince: trimmed(100).optional(),
    postalCode: trimmed(20).optional(),
    countryCode: CountryCodeSchema,
  })
  .strict();

export const AddressIndonesiaSchema = z
  .object({
    line1: trimmed(200), // jalan, nomor, RT/RW
    line2: trimmed(200).optional(), // kelurahan/desa, kecamatan
    city: trimmed(100), // kota/kabupaten
    province: trimmed(100),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "5-digit kode pos")
      .optional(),
  })
  .strict();

export const EmergencyContactSchema = z
  .object({
    phone: PhoneE164Schema,
    name: trimmed(200).optional(),
    relationship: trimmed(100).optional(),
  })
  .strict();

/** Builds the profile input schema relative to an injected clock (no hidden `Date.now()`). */
export function memberProfileInputSchema(now: Date) {
  const year = now.getUTCFullYear();
  return z
    .object({
      fullName: trimmed(200),
      gender: z.enum(GENDERS),
      dateOfBirth: z.iso.date(), // YYYY-MM-DD
      ppiCountry: CountryCodeSchema,
      university: trimmed(200),
      /** The campus picked from the universities master (the name is then taken from it). */
      universityId: safeId.nullable().optional(),
      educationLevel: z.enum(EDUCATION_LEVELS),
      majors: z.array(trimmed(150)).min(1).max(3),
      yearOfEntry: z
        .number()
        .int()
        .min(1950)
        .max(year + 1),
      estimatedGraduationYear: z
        .number()
        .int()
        .min(1950)
        .max(year + 15),
      addressAbroad: AddressAbroadSchema,
      addressIndonesia: AddressIndonesiaSchema,
      whatsappNumber: PhoneE164Schema,
      emergencyContact: EmergencyContactSchema,
      timezone: TimezoneSchema,
      consent: z
        .object({
          privacyPolicyVersion: trimmed(20),
          accepted: z.literal(true),
        })
        .strict(),
    })
    .strict()
    .superRefine((input, ctx) => {
      const age = ageOn(input.dateOfBirth, now);
      if (age < 15 || age > 100) {
        ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Age must be 15–100" });
      }
      if (input.estimatedGraduationYear < input.yearOfEntry) {
        ctx.addIssue({
          code: "custom",
          path: ["estimatedGraduationYear"],
          message: "Graduation cannot be before entry",
        });
      }
      if (input.estimatedGraduationYear > input.yearOfEntry + 15) {
        ctx.addIssue({
          code: "custom",
          path: ["estimatedGraduationYear"],
          message: "Graduation must be within 15 years of entry",
        });
      }
    });
}
export type MemberProfileInput = z.infer<ReturnType<typeof memberProfileInputSchema>>;

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC). */
export function ageOn(dateOfBirth: string, now: Date): number {
  const [y, m, d] = dateOfBirth.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Stored profile. `email` is copied from the verified auth account, never typed by the user. */
export interface MemberProfile extends EntityMeta, Omit<MemberProfileInput, "consent"> {
  readonly userId: string;
  readonly email: string;
  readonly consent: { readonly privacyPolicyVersion: string; readonly consentedAt: Date };
}

/**
 * Field classification. `basic` is visible with `members.read`; `restricted` needs
 * `members.pii`. Every field must be classified (compile-time checked).
 */
export type ProfileField = Exclude<keyof MemberProfile, keyof EntityMeta | "userId" | "consent">;
export const PROFILE_FIELD_CLASS = {
  fullName: "basic",
  ppiCountry: "basic",
  university: "basic",
  universityId: "basic",
  educationLevel: "basic",
  majors: "basic",
  yearOfEntry: "basic",
  estimatedGraduationYear: "basic",
  timezone: "basic",
  gender: "restricted",
  dateOfBirth: "restricted",
  addressAbroad: "restricted",
  addressIndonesia: "restricted",
  whatsappNumber: "restricted",
  emergencyContact: "restricted",
  email: "restricted",
} as const satisfies Record<ProfileField, "basic" | "restricted">;

export const RESTRICTED_PROFILE_FIELDS = (
  Object.keys(PROFILE_FIELD_CLASS) as ProfileField[]
).filter((field) => PROFILE_FIELD_CLASS[field] === "restricted");

/** The view returned to staff without `members.pii`. */
export type MemberProfileBasic = Pick<
  MemberProfile,
  | "userId"
  | "fullName"
  | "ppiCountry"
  | "university"
  | "educationLevel"
  | "majors"
  | "yearOfEntry"
  | "estimatedGraduationYear"
  | "timezone"
>;

export function toBasicView(profile: MemberProfile): MemberProfileBasic {
  return {
    userId: profile.userId,
    fullName: profile.fullName,
    ppiCountry: profile.ppiCountry,
    university: profile.university,
    educationLevel: profile.educationLevel,
    majors: profile.majors,
    yearOfEntry: profile.yearOfEntry,
    estimatedGraduationYear: profile.estimatedGraduationYear,
    timezone: profile.timezone,
  };
}

type Snapshot = Record<string, unknown>;

/**
 * Audit snapshots for a profile change. Restricted values are NEVER written to the audit log:
 * they appear only as "[changed]" / "[unchanged]". Consequently a change that touches a
 * restricted field is not revertible from the audit log (the user/admin re-enters it).
 */
export function profileAuditSnapshots(
  before: Partial<Record<ProfileField, unknown>> | null,
  after: Partial<Record<ProfileField, unknown>> | null,
): { before: Snapshot | null; after: Snapshot | null; revertible: boolean } {
  let restrictedChanged = false;
  const redact = (side: Partial<Record<ProfileField, unknown>> | null, isAfter: boolean) => {
    if (side === null) return null;
    const out: Snapshot = {};
    for (const field of Object.keys(PROFILE_FIELD_CLASS) as ProfileField[]) {
      if (!(field in side)) continue;
      if (PROFILE_FIELD_CLASS[field] === "restricted") {
        const changed = JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]);
        if (changed) restrictedChanged = true;
        out[field] = changed ? (isAfter ? "[changed]" : "[previous]") : "[unchanged]";
      } else {
        out[field] = side[field];
      }
    }
    return out;
  };
  const b = redact(before, false);
  const a = redact(after, true);
  return { before: b, after: a, revertible: !restrictedChanged && before !== null };
}

/** Firestore-backed in @website/db. */
export interface MemberProfileRepository {
  findByUserId(userId: string): Promise<MemberProfile | null>;
  /** Must fail with ConcurrencyConflictError when expectedVersion is stale. */
  save(profile: MemberProfile, expectedVersion: number | null): Promise<MemberProfile>;
}

/**
 * Date the Privacy Policy (and Terms) last changed. Members agree to this version on their
 * profile; after a change the profile counts as incomplete until they agree again.
 */
export const PRIVACY_POLICY_VERSION = "2026-10-18";

/** A saved profile that agreed to the current policy (gate for admin and member-only pages). */
export function isProfileComplete(profile: Pick<MemberProfile, "consent"> | null): boolean {
  return profile !== null && profile.consent.privacyPolicyVersion === PRIVACY_POLICY_VERSION;
}

/**
 * The stored profile for a member's own save. The e-mail comes from the verified session; the
 * consent date stays the first one unless the member agrees to a newer policy.
 */
export function ownProfile(
  input: MemberProfileInput,
  owner: { readonly userId: string; readonly email: string },
  current: MemberProfile | null,
  now: Date,
): MemberProfile {
  if (input.consent.privacyPolicyVersion !== PRIVACY_POLICY_VERSION) {
    throw new RuleViolationError("The privacy policy changed: read it and agree again.");
  }
  const sameConsent = current?.consent.privacyPolicyVersion === PRIVACY_POLICY_VERSION;
  return {
    ...input,
    universityId: input.universityId ?? null,
    userId: owner.userId,
    email: owner.email,
    consent: {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      consentedAt: sameConsent ? current.consent.consentedAt : now,
    },
    id: owner.userId,
    version: (current?.version ?? 0) + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
}
