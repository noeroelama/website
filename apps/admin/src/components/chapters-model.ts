import type { FeaturedImage } from "@website/domain/content";
import type { Chapter, ChapterRisk, SocialLink } from "@website/domain/organizations";

/** A PPI chapter row of Organizations → PPI, mapped on the server from `chapters/{id}`. */
export interface ChapterItem {
  id: string;
  version: number;
  name: string;
  slug: string;
  countryCode: string;
  /** English country name (Intl, computed on the server). */
  country: string;
  timezone: string;
  /** The time zone's offset now, e.g. "UTC+10:00" (computed on the server). */
  utcOffset: string;
  active: boolean;
  logo: FeaturedImage | null;
  contactName: string;
  contactPublic: string;
  website: string | null;
  email: string | null;
  instagram: string | null;
  socials: SocialLink[];
  latitude: number;
  longitude: number;
  memberCount: number;
  conditions: string[];
  risk: ChapterRisk;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "UTC+10:00" for a time zone at this moment ("GMT" alone means UTC+00:00). */
function utcOffset(timeZone: string): string {
  const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  return name === "GMT" || !name ? "UTC+00:00" : name.replace("GMT", "UTC");
}

export function toChapterItem(c: Chapter): ChapterItem {
  return {
    id: c.id,
    version: c.version,
    name: c.name,
    slug: c.slug,
    countryCode: c.countryCode,
    country: regionNames.of(c.countryCode) ?? c.countryCode,
    timezone: c.timezone,
    utcOffset: utcOffset(c.timezone),
    active: c.active,
    logo: c.logo,
    contactName: c.contactName,
    contactPublic: c.contactPublic,
    website: c.website,
    email: c.email,
    instagram: c.instagram,
    socials: [...c.socials],
    latitude: c.latitude,
    longitude: c.longitude,
    memberCount: c.memberCount,
    conditions: [...c.conditions],
    risk: c.risk,
  };
}
