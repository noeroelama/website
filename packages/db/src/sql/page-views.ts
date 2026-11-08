import { createHash } from "node:crypto";
import type { Database } from "./store";

export const SITE_PAGE = "*";
const MAX_REFERRERS = 20;
const VISIT_MARKER_MS = 2 * 86_400_000;

export type PageViewKind = "day" | "month" | "year";

export interface PageViewHit {
  readonly page: string;
  readonly visitor: string;
  readonly mobile: boolean;
  readonly referrer: string | null;
  readonly at: Date;
}

export interface PageViewStat {
  readonly page: string;
  readonly period: string;
  readonly views: number;
  readonly visits: number;
  readonly mobile: number;
  readonly referrers: ReadonlyArray<{ host: string; visits: number }>;
  readonly lastViewedAt: Date | null;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const num = (value: unknown) => (typeof value === "number" ? value : 0);

function toStat(data: Record<string, unknown> | undefined, page: string, period: string) {
  const last = data?.["lastViewedAt"] as { toDate(): Date } | undefined;
  return {
    page: typeof data?.["page"] === "string" ? data["page"] : page,
    period,
    views: num(data?.["views"]),
    visits: num(data?.["visits"]),
    mobile: num(data?.["mobile"]),
    referrers: Array.isArray(data?.["referrers"])
      ? (data["referrers"] as PageViewStat["referrers"])
      : [],
    lastViewedAt: last ? last.toDate() : null,
  } satisfies PageViewStat;
}

function addReferrer(list: PageViewStat["referrers"], host: string) {
  const found = list.some((r) => r.host === host);
  // shortcut: hosts past the first 20 per page and period are not counted; fine at this traffic.
  if (!found && list.length >= MAX_REFERRERS) return list;
  const next = found
    ? list.map((r) => (r.host === host ? { host, visits: r.visits + 1 } : r))
    : [...list, { host, visits: 1 }];
  return next.sort((a, b) => b.visits - a.visits);
}

export function periodsOf(at: Date): Array<[PageViewKind, string]> {
  const day = at.toISOString().slice(0, 10);
  return [
    ["day", day],
    ["month", day.slice(0, 7)],
    ["year", day.slice(0, 4)],
  ];
}

export function createSqlPageViewStore(db: Database) {
  const stats = db.collection("pageViewStats");
  const visits = db.collection("pageViewVisits");
  const statRef = (kind: PageViewKind, period: string, page: string) =>
    stats.doc(`${kind}_${period}_${digest(page)}`);

  return {
    record(hit: PageViewHit): Promise<void> {
      const pages = [hit.page, SITE_PAGE];
      const markers = pages.map((page) => visits.doc(digest(`${hit.visitor}|${page}`)));
      const targets = pages.flatMap((page, p) =>
        periodsOf(hit.at).map(([kind, period]) => ({ p, page, kind, period })),
      );
      return db.runTransaction(async (tx) => {
        const seen = await Promise.all(markers.map((ref) => tx.get(ref)));
        const current = await Promise.all(
          targets.map((t) => tx.get(statRef(t.kind, t.period, t.page))),
        );
        markers.forEach((ref, i) => {
          if (!seen[i]?.exists) {
            tx.set(ref, { expiresAt: new Date(hit.at.getTime() + VISIT_MARKER_MS) });
          }
        });
        targets.forEach((t, i) => {
          const fresh = !seen[t.p]?.exists;
          const old = toStat(current[i]?.data(), t.page, t.period);
          tx.set(statRef(t.kind, t.period, t.page), {
            kind: t.kind,
            period: t.period,
            page: t.page,
            views: old.views + 1,
            visits: old.visits + (fresh ? 1 : 0),
            mobile: old.mobile + (fresh && hit.mobile ? 1 : 0),
            referrers:
              fresh && hit.referrer ? addReferrer(old.referrers, hit.referrer) : old.referrers,
            lastViewedAt: hit.at,
          });
        });
      });
    },

    async series(page: string, kind: PageViewKind, periods: string[]): Promise<PageViewStat[]> {
      const snapshots = await db.getAll(...periods.map((period) => statRef(kind, period, page)));
      return snapshots.map((snap, i) =>
        toStat(snap.data() as Record<string, unknown> | undefined, page, periods[i] ?? ""),
      );
    },

    async pages(kind: PageViewKind, period: string): Promise<PageViewStat[]> {
      const found = await stats.where("kind", "==", kind).where("period", "==", period).get();
      return found.docs
        .map((doc) => toStat(doc.data() as Record<string, unknown>, "", period))
        .filter((stat) => stat.page !== SITE_PAGE)
        .sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));
    },
  };
}

export type SqlPageViewStore = ReturnType<typeof createSqlPageViewStore>;
