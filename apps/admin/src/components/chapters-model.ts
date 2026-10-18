import type { FeaturedImage } from "@website/domain/content";
import type { Chapter, SocialLink } from "@website/domain/organizations";

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
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function toChapterItem(c: Chapter): ChapterItem {
  return {
    id: c.id,
    version: c.version,
    name: c.name,
    slug: c.slug,
    countryCode: c.countryCode,
    country: regionNames.of(c.countryCode) ?? c.countryCode,
    timezone: c.timezone,
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
  };
}
