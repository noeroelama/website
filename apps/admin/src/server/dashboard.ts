import "server-only";
import type { AuditEvent } from "@website/audit";
import type { DashboardCounter, FirestoreDashboardCounts } from "@website/db/firestore";
import type { AuditListQuery } from "@website/db/firestore";
import { can, canInSomeScope, type PagePermission, type Principal } from "@website/permissions";

/** Dashboard counters, each shown only to staff who can read its page. */
export const DASHBOARD_COUNTERS: ReadonlyArray<{
  readonly key: DashboardCounter;
  readonly permission: PagePermission;
  readonly label: string;
  readonly href: string;
}> = [
  { key: "events", permission: "events.read", label: "Events", href: "/events" },
  { key: "albums", permission: "gallery.read", label: "Albums", href: "/gallery" },
  {
    key: "articles",
    permission: "articles.read",
    label: "Articles",
    href: "/articles",
  },
  {
    key: "subscribers",
    permission: "newsletter.read",
    label: "Confirmed subscribers",
    href: "/newsletter",
  },
];

/**
 * The dashboard for one staff member: counters for the pages they can read (Firestore count())
 * and, with audit.read, the 10 newest audit entries. Nothing is counted for hidden pages.
 */
export function createDashboard(deps: {
  counts: Pick<FirestoreDashboardCounts, "count">;
  listAudit: (query: AuditListQuery) => Promise<{ items: AuditEvent[] }>;
  /** Officers of the active period who graduated (B5): for whoever may end appointments. */
  graduatedOfficers: () => Promise<GraduatedOfficer[]>;
}) {
  return async (principal: Principal) => {
    const visible = DASHBOARD_COUNTERS.filter((c) => canInSomeScope(principal, c.permission));
    const [values, audit, graduated] = await Promise.all([
      Promise.all(visible.map((c) => deps.counts.count(c.key))),
      can(principal, "audit.read") ? deps.listAudit({ limit: 10 }) : null,
      can(principal, "appointments.edit") ? deps.graduatedOfficers() : null,
    ]);
    return {
      counters: visible.map((c, i) => ({ ...c, value: values[i] as number })),
      audit: audit ? audit.items : null,
      graduatedOfficers: graduated,
    };
  };
}

/** One "graduated but still in office" item: the appointment stays until someone ends it. */
export interface GraduatedOfficer {
  readonly name: string;
  readonly title: string;
  readonly graduatedOn: string;
  readonly periodId: string;
}
