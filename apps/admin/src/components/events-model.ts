import {
  sortedSponsors,
  type EventEntity,
  type EventImage,
  type EventType,
  type ScheduleRow,
  type Speaker,
  type Sponsor,
} from "@website/domain/events";
import { EVENT_TYPE_LABELS, label } from "../labels";

/**
 * What the Event page shows and edits, mapped on the server from `events/{id}`. The page lists,
 * filters and pages these rows in the browser (at most the 500 most recently changed events).
 */
export type EventStatus = "published" | "draft";
export type EventTab = "all" | "upcoming" | "past" | "drafts";

export interface EventItem {
  id: string;
  version: number;
  title: string;
  type: EventType;
  typeLabel: string;
  /** ISO start (UTC). Upcoming/past is decided against now. */
  startsAt: string;
  timezone: string;
  registrationClosesAt: string | null;
  location: string;
  /** Public slug, e.g. "simposium-2026". */
  url: string;
  description: string;
  registrationUrl: string | null;
  banner: EventImage | null;
  status: EventStatus;
  /** ISO timestamp of the last change. */
  modifiedAt: string;
  schedule: ScheduleRow[];
  speakers: Speaker[];
  /** In display order. */
  sponsors: Sponsor[];
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/** "All" = every event; "Drafts" = drafts; Upcoming/Past = published events by start time. */
export function matchesTab(e: EventItem, tab: EventTab, nowIso: string): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return e.status === "draft";
  if (e.status === "draft") return false;
  return tab === "upcoming" ? e.startsAt >= nowIso : e.startsAt < nowIso;
}

/** Server-side mapping to a table row (plain JSON for the client page). */
export function toEventItem(e: EventEntity): EventItem {
  return {
    id: e.id,
    version: e.version,
    title: e.title,
    type: e.type,
    typeLabel: label(EVENT_TYPE_LABELS, e.type),
    startsAt: e.startsAt.toISOString(),
    timezone: e.timezone,
    registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null,
    location: e.location ?? "",
    url: e.slug,
    description: e.description,
    registrationUrl: e.registrationUrl,
    banner: e.bannerImage,
    status: e.published ? "published" : "draft",
    modifiedAt: e.updatedAt.toISOString(),
    schedule: [...e.schedule],
    speakers: [...e.speakers],
    sponsors: sortedSponsors(e.sponsors),
  };
}
