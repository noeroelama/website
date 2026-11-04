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
import type { Author } from "./authors";
import { esc } from "./format";

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
  /** Who made the last change (from the audit log); null when unknown. */
  author: Author | null;
  schedule: ScheduleRow[];
  speakers: Speaker[];
  /** In display order. */
  sponsors: Sponsor[];
}

/** "All" = every event; "Drafts" = drafts; Upcoming/Past = published events by start time. */
export function matchesTab(e: EventItem, tab: EventTab, nowIso: string): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return e.status === "draft";
  if (e.status === "draft") return false;
  return tab === "upcoming" ? e.startsAt >= nowIso : e.startsAt < nowIso;
}

/** "In 44 days" under the Event Date while the event is at least part of a day ahead, else null. */
export function countdownLabel(startsAt: string, now: number): string | null {
  const days = Math.ceil((Date.parse(startsAt) - now) / 86_400_000);
  if (Number.isNaN(days) || days < 1) return null;
  return days === 1 ? "In 1 day" : `In ${days} days`;
}

/** Server-side mapping to a table row (plain JSON for the client page). */
export function toEventItem(e: EventEntity, author: Author | null): EventItem {
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
    author,
    schedule: [...e.schedule],
    speakers: [...e.speakers],
    sponsors: sortedSponsors(e.sponsors),
  };
}

/** Export CSV of the listed events (cells already quoted for `downloadCsv`), dates in UTC. */
export function eventsCsv(rows: readonly EventItem[]): string[][] {
  const header = [
    "Title",
    "Type",
    "Start (UTC)",
    "Location",
    "Status",
    "Modified (UTC)",
    "Modified by",
  ];
  return [
    header.map(esc),
    ...rows.map((e) =>
      [
        e.title,
        e.typeLabel,
        e.startsAt.slice(0, 16).replace("T", " "),
        e.location,
        e.status === "published" ? "Public" : "Draft",
        e.modifiedAt.slice(0, 16).replace("T", " "),
        e.author?.name ?? "",
      ].map(esc),
    ),
  ];
}
