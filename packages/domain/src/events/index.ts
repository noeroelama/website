import { z } from "zod";
import { safeText } from "@website/security/validation";
import { FeaturedImageSchema, type FeaturedImage } from "../content";
import { TimezoneSchema } from "../members/profile";
import { isValidSlug, type EntityMeta } from "../shared";

/** Event types (Figma EVENT DASHBOARD); labels live in the apps' label maps. */
export const EVENT_TYPES = [
  "general",
  "seminar",
  "webinar",
  "discussion",
  "workshop",
  "launch",
  "event",
  "festival",
  "conference",
  "exhibition",
  "meeting",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Uploaded image (public preset), same shape as a news featured image. */
export type EventImage = FeaturedImage;

export interface ScheduleRow {
  /** "HH:MM" in the event's time zone, or "" when not timed. */
  readonly time: string;
  readonly title: string;
  readonly description: string;
}
export interface Speaker {
  readonly name: string;
  readonly description: string;
  readonly photo: EventImage | null;
}
export interface Sponsor {
  /** Display position (1 = first). */
  readonly order: number;
  readonly logo: EventImage | null;
  readonly caption: string;
}

export interface EventEntity extends EntityMeta {
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timezone: string;
  readonly location: string | null;
  readonly chapterId: string | null;
  readonly published: boolean;
  readonly capacity: number | null;
  readonly registrationClosesAt: Date | null;
  readonly type: EventType;
  /** Long text (plain, line breaks kept). */
  readonly description: string;
  readonly bannerImage: EventImage | null;
  /** External registration form; null = the site's own registration. */
  readonly registrationUrl: string | null;
  readonly schedule: readonly ScheduleRow[];
  readonly speakers: readonly Speaker[];
  readonly sponsors: readonly Sponsor[];
}

/** Sponsors in display order. */
export function sortedSponsors(sponsors: readonly Sponsor[]): Sponsor[] {
  return [...sponsors].sort((a, b) => a.order - b.order);
}

/** What visitors see of a published event (web). The id is kept for registrations. */
export interface PublicEvent {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly type: EventType;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly registrationClosesAt: Date | null;
  readonly location: string | null;
  readonly chapterId: string | null;
  readonly description: string;
  readonly bannerImage: EventImage | null;
  readonly registrationUrl: string | null;
  readonly schedule: readonly ScheduleRow[];
  readonly speakers: readonly Speaker[];
  readonly sponsors: readonly Sponsor[];
}

export function toPublicEvent(e: EventEntity): PublicEvent {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    type: e.type,
    startsAt: e.startsAt,
    timezone: e.timezone,
    registrationClosesAt: e.registrationClosesAt,
    location: e.location,
    chapterId: e.chapterId,
    description: e.description,
    bannerImage: e.bannerImage,
    registrationUrl: e.registrationUrl,
    schedule: e.schedule,
    speakers: e.speakers,
    sponsors: sortedSponsors(e.sponsors),
  };
}

/** URL slug when the editor leaves the URL empty: "event-" + 8 random hex characters. */
export function randomEventSlug(uuid: string): string {
  return `event-${uuid.replace(/-/g, "").slice(0, 8)}`;
}

const optionalText = (max: number) => safeText(max, { multiline: true, allowEmpty: true });
const linkSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || /^https?:\/\/[^\s]+$/i.test(value), "Use an http(s):// link.")
  .transform((value) => value || null);

/** The Event form (add + edit). Sponsors get their order from their position in the list. */
export const EventInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(3, "Enter a title (at least 3 characters).")),
    type: z.enum(EVENT_TYPES, { error: "Choose an event type." }),
    startsAt: z.coerce.date({ error: "Enter the event date and time." }),
    timezone: TimezoneSchema,
    registrationClosesAt: z.coerce.date().nullable(),
    location: safeText(300).pipe(z.string().min(2, "Enter the location.")),
    description: safeText(5000, { multiline: true }),
    bannerImage: FeaturedImageSchema.nullable().refine((v) => v !== null, "Upload a banner."),
    registrationUrl: linkSchema,
    /** Empty = random. */
    slug: z
      .string()
      .trim()
      .max(120)
      .refine((s) => s === "" || isValidSlug(s), "Use lower-case letters, numbers and dashes."),
    schedule: z
      .array(
        z
          .object({
            time: z.string().regex(/^(|([01]\d|2[0-3]):[0-5]\d)$/, "Use HH:MM."),
            title: safeText(200),
            description: optionalText(500),
          })
          .strict(),
      )
      .max(50),
    speakers: z
      .array(
        z
          .object({
            name: safeText(120),
            description: optionalText(500),
            photo: FeaturedImageSchema.nullable(),
          })
          .strict(),
      )
      .max(30),
    sponsors: z
      .array(z.object({ logo: FeaturedImageSchema.nullable(), caption: safeText(200) }).strict())
      .max(50),
  })
  .strict()
  .refine((e) => e.registrationClosesAt === null || e.registrationClosesAt <= e.startsAt, {
    path: ["registrationClosesAt"],
    message: "The deadline must be on or before the event date.",
  });
export type EventInput = z.infer<typeof EventInputSchema>;

export function isRegistrationOpen(
  event: Pick<EventEntity, "published" | "deletedAt" | "startsAt" | "registrationClosesAt">,
  now: Date,
): boolean {
  if (!event.published || event.deletedAt !== null) return false;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  return now < closesAt;
}

export type RegistrationStatus = "confirmed" | "waitlisted" | "cancelled";

/**
 * A registration links a signed-in user to an event. Personal data is NOT copied here:
 * it lives once in `memberProfiles/{uid}` and is joined for authorized staff only.
 * Stored at `eventRegistrations/{eventId}_{userId}` so one user registers at most once
 * per event (enforced by the document id inside a transaction).
 */
export interface EventRegistration {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly status: RegistrationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function registrationId(eventId: string, userId: string): string {
  return `${eventId}_${userId}`;
}

/** Capacity rule: confirmed while seats remain, otherwise waitlisted. */
export function nextRegistrationStatus(
  event: Pick<EventEntity, "capacity">,
  confirmedCount: number,
): RegistrationStatus {
  return event.capacity === null || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
}

export interface EventReader {
  listPublished(input: {
    chapterId?: string;
    updatedSince?: Date;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: EventEntity[];
    nextCursor: string | null;
  }>;
  findById(id: string): Promise<EventEntity | null>;
}

/** Zoom (or another provider) behind a port; called synchronously with a timeout. */
export interface MeetingProvider {
  createMeeting(input: {
    topic: string;
    startsAt: Date;
    durationMinutes: number;
    timezone: string;
  }): Promise<{
    meetingId: string;
    joinUrl: string;
  }>;
}

/** Calendar output is an ICS feed, not a two-way integration. */
export interface CalendarFeed {
  render(events: readonly EventEntity[]): string;
}
