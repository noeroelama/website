import "server-only";
import { lazyEnv } from "@website/config/env";
import {
  createSqlPageViewStore,
  periodsOf,
  SITE_PAGE,
  type PageViewKind,
  type SqlPageViewStore,
} from "@website/db/sql";
import { adminDb } from "./stores";

export const pageViewStore = lazyEnv(() => createSqlPageViewStore(adminDb()));

const DAY_MS = 86_400_000;

function lastPeriods(now: Date, kind: PageViewKind, count: number): string[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const back = count - 1 - i;
    if (kind === "day") return new Date(now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    if (kind === "month") return new Date(Date.UTC(y, m - back, 1)).toISOString().slice(0, 7);
    return String(y - back);
  });
}

const average = (rows: { views: number }[]) =>
  Math.round(rows.reduce((sum, r) => sum + r.views, 0) / rows.length);

export async function pageViewReport(
  store: SqlPageViewStore,
  now: Date,
  query: { range: PageViewKind; page: string | null },
) {
  const page = query.page ?? SITE_PAGE;
  const series = async (kind: PageViewKind, count: number) =>
    (await store.series(page, kind, lastPeriods(now, kind, count))).map((s) => ({
      label: s.period,
      views: s.views,
      visits: s.visits,
    }));
  const period = new Map(periodsOf(now)).get(query.range) ?? "";
  const [daily, monthly, yearly, pages] = await Promise.all([
    series("day", 30),
    series("month", 12),
    series("year", 5),
    store.pages(query.range, period),
  ]);
  return {
    page,
    range: query.range,
    period,
    daily,
    monthly,
    yearly,
    totals: {
      today: daily.at(-1)?.views ?? 0,
      month: monthly.at(-1)?.views ?? 0,
      year: yearly.at(-1)?.views ?? 0,
    },
    averages: { perDay: average(daily), perMonth: average(monthly), perYear: average(yearly) },
    pages,
  };
}
