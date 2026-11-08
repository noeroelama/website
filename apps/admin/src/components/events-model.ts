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

export type EventStatus = "published" | "draft";
export type EventTab = "all" | "upcoming" | "past" | "drafts";

export interface EventItem {
  id: string;
  version: number;
  title: string;
  type: EventType;
  typeLabel: string;
  startsAt: string;
  timezone: string;
  registrationClosesAt: string | null;
  location: string;
  url: string;
  description: string;
  registrationUrl: string | null;
  banner: EventImage | null;
  status: EventStatus;
  modifiedAt: string;
  author: Author | null;
  schedule: ScheduleRow[];
  speakers: Speaker[];
  sponsors: Sponsor[];
}

export function matchesTab(e: EventItem, tab: EventTab, nowIso: string): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return e.status === "draft";
  if (e.status === "draft") return false;
  return tab === "upcoming" ? e.startsAt >= nowIso : e.startsAt < nowIso;
}

export function countdownLabel(startsAt: string, now: number): string | null {
  const days = Math.ceil((Date.parse(startsAt) - now) / 86_400_000);
  if (Number.isNaN(days) || days < 1) return null;
  return days === 1 ? "In 1 day" : `In ${days} days`;
}

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
