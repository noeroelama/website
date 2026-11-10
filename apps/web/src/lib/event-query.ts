import { type EventType, type PublicEvent } from "@website/domain/events";
import { ORGANISATION_TIME_ZONE } from "@website/domain/documents";
import type { PublicAlbum } from "@website/domain/gallery";

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export const EVENT_PAGE_SIZE = 12;

export const TIME_RANGES = ["upcoming", "week", "month", "year", "custom"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

const CATEGORY_TYPES = [
  "seminar",
  "workshop",
  "webinar",
  "conference",
  "meeting",
] as const satisfies readonly EventType[];
export type PillCategory = (typeof CATEGORY_TYPES)[number];
export type EventCategory = "all" | PillCategory | "other";
export const EVENT_CATEGORIES: readonly EventCategory[] = ["all", ...CATEGORY_TYPES, "other"];

export interface EventQuery {
  readonly category: EventCategory | null;
  readonly q: string | null;
  readonly region: string | null;
  readonly time: TimeRange;
  readonly from: string | null;
  readonly to: string | null;
  readonly page: number;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const day = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export function eventQuery(params: Record<string, string | string[] | undefined>): EventQuery {
  const category = one(params["category"]);
  const q = one(params["q"])?.trim().slice(0, 100) || null;
  const region = one(params["region"])?.trim().slice(0, 60) || null;
  const time = one(params["time"]);
  const page = Number(one(params["page"]));
  return {
    category: EVENT_CATEGORIES.find((c) => c === category) ?? null,
    q,
    region,
    time: TIME_RANGES.find((r) => r === time) ?? "upcoming",
    from: day(one(params["from"])),
    to: day(one(params["to"])),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function matchesEventType(type: EventType | null, category: EventCategory | null): boolean {
  return (
    category === null ||
    category === "all" ||
    (category === "other"
      ? !(CATEGORY_TYPES as readonly EventType[]).includes(type as EventType)
      : type === category)
  );
}

export function matchesCategory(e: PublicEvent, category: EventCategory | null): boolean {
  return matchesEventType(e.type, category);
}

export function regionsOf(events: readonly PublicEvent[]): string[] {
  const regions: string[] = [];
  for (const e of events) {
    if (!e.location) continue;
    const region = e.location
      .split(",")
      .pop()
      ?.trim()
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
    if (region && !regions.includes(region)) regions.push(region);
  }
  return regions;
}

export function timeBounds(
  range: TimeRange,
  now: Date,
): { from: string | null; to: string | null } {
  const today = dayIn(now, ORGANISATION_TIME_ZONE);
  if (range === "upcoming") return { from: today, to: null };
  const add = (days: number) =>
    dayIn(new Date(now.getTime() + days * 86_400_000), ORGANISATION_TIME_ZONE);
  const year = today.slice(0, 4);
  const yearEnd = `${year}-12-31`;
  if (range === "week") return { from: today, to: add(7) < yearEnd ? add(7) : yearEnd };
  if (range === "month") return { from: today, to: add(30) < yearEnd ? add(30) : yearEnd };
  if (range === "year") return { from: `${year}-01-01`, to: yearEnd };
  return { from: null, to: null };
}

export function pageOfEvents(all: readonly PublicEvent[], query: EventQuery, now = new Date()) {
  const { from: presetFrom, to: presetTo } = timeBounds(query.time, now);
  const q = query.q?.toLocaleLowerCase() ?? null;
  const region = query.region?.toLocaleLowerCase() ?? null;
  const matching = all.filter((e) => {
    const start = dayIn(e.startsAt, e.timezone);
    return (
      matchesCategory(e, query.category) &&
      (q === null || e.title.toLocaleLowerCase().includes(q)) &&
      (region === null || (e.location ?? "").toLocaleLowerCase().endsWith(region)) &&
      (presetFrom === null || start >= presetFrom) &&
      (presetTo === null || start <= presetTo) &&
      (query.from === null || start >= query.from) &&
      (query.to === null || start <= query.to)
    );
  });
  if (query.time === "upcoming" || query.time === "week" || query.time === "month") {
    matching.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  const pages = Math.max(1, Math.ceil(matching.length / EVENT_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    items: matching.slice((page - 1) * EVENT_PAGE_SIZE, page * EVENT_PAGE_SIZE),
    count: matching.length,
    page,
    pages,
  };
}

export function eventsHref(query: EventQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.q) params.set("q", query.q);
  if (query.region) params.set("region", query.region);
  if (query.time !== "upcoming") params.set("time", query.time);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/events?${search}` : "/events";
}

export interface AlbumQuery {
  readonly category: EventCategory | null;
  readonly q: string | null;
  readonly region: string | null;
  readonly time: TimeRange | null;
  readonly page: number;
}

const range = (value: string | string[] | undefined): TimeRange | null => {
  const one = Array.isArray(value) ? value[0] : value;
  return TIME_RANGES.find((r) => r === one && r !== "custom") ?? null;
};

const num = (value: string | string[] | undefined) => {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

export function albumQuery(params: Record<string, string | string[] | undefined>): AlbumQuery {
  const category = Array.isArray(params["category"]) ? params["category"][0] : params["category"];
  const q =
    (Array.isArray(params["q"]) ? params["q"][0] : params["q"])?.trim().slice(0, 100) || null;
  const region =
    (Array.isArray(params["region"]) ? params["region"][0] : params["region"])
      ?.trim()
      .slice(0, 60) || null;
  return {
    category: EVENT_CATEGORIES.find((c) => c === category) ?? null,
    q,
    region,
    time: range(params["time"]),
    page: num(params["page"]),
  };
}

export function albumRegionsOf(albums: readonly PublicAlbum[]): string[] {
  const regions: string[] = [];
  for (const a of albums) {
    if (!a.eventLocation) continue;
    const region = a.eventLocation
      .split(",")
      .pop()
      ?.trim()
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
    if (region && !regions.includes(region)) regions.push(region);
  }
  return regions;
}

export function pageOfAlbums(albums: readonly PublicAlbum[], query: AlbumQuery, now = new Date()) {
  const { from, to } = query.time ? timeBounds(query.time, now) : { from: null, to: null };
  const q = query.q?.toLocaleLowerCase() ?? null;
  const region = query.region?.toLocaleLowerCase() ?? null;
  const matching = albums.filter((a) => {
    const start = a.eventStartsAt ? dayIn(a.eventStartsAt, ORGANISATION_TIME_ZONE) : null;
    return (
      matchesEventType(a.eventType, query.category) &&
      (q === null || a.eventTitle.toLocaleLowerCase().includes(q)) &&
      (region === null || (a.eventLocation ?? "").toLocaleLowerCase().endsWith(region)) &&
      (from === null || (start !== null && start >= from)) &&
      (to === null || (start !== null && start <= to))
    );
  });
  const pages = Math.max(1, Math.ceil(matching.length / EVENT_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    items: matching.slice((page - 1) * EVENT_PAGE_SIZE, page * EVENT_PAGE_SIZE),
    count: matching.length,
    page,
    pages,
  };
}

export function albumsHref(query: AlbumQuery, page = 1): string {
  const params = new URLSearchParams();
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.q) params.set("q", query.q);
  if (query.region) params.set("region", query.region);
  if (query.time) params.set("time", query.time);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/gallery?${search}` : "/gallery";
}
