import { EVENT_TYPES, type EventType, type PublicEvent } from "@website/domain/events";

export const EVENT_PAGE_SIZE = 12;

export interface EventQuery {
  readonly type: EventType | null;
  /** YYYY-MM-DD (UTC day of the start), inclusive. */
  readonly from: string | null;
  readonly to: string | null;
  readonly page: number;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const day = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

/** /events?type=…&from=…&to=…&page=… → a safe query; anything unknown is ignored. */
export function eventQuery(params: Record<string, string | string[] | undefined>): EventQuery {
  const type = one(params["type"]);
  const page = Number(one(params["page"]));
  return {
    type: EVENT_TYPES.find((t) => t === type) ?? null,
    from: day(one(params["from"])),
    to: day(one(params["to"])),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Filters (type AND date range) and pages the published events; `pages` is at least 1. */
export function pageOfEvents(all: readonly PublicEvent[], query: EventQuery) {
  const matching = all.filter((e) => {
    const start = e.startsAt.toISOString().slice(0, 10);
    return (
      (query.type === null || e.type === query.type) &&
      (query.from === null || start >= query.from) &&
      (query.to === null || start <= query.to)
    );
  });
  const pages = Math.max(1, Math.ceil(matching.length / EVENT_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    items: matching.slice((page - 1) * EVENT_PAGE_SIZE, page * EVENT_PAGE_SIZE),
    page,
    pages,
  };
}

/** Link to another page of the same filtered list. */
export function eventsHref(query: EventQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/events?${search}` : "/events";
}
