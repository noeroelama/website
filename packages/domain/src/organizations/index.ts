import { z } from "zod";
import { safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { TimezoneSchema } from "../members/profile";
import { isValidSlug, type EntityMeta } from "../shared";

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
