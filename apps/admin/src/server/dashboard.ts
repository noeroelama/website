import "server-only";
import type { AuditEvent } from "@website/audit";
import type { DashboardCounter, SqlDashboardCounts } from "@website/db/sql";
import type { AuditListQuery } from "@website/db/sql";
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
 * The dashboard for one staff member: counters for the pages they can read (COUNT queries)
 * and, with audit.read, the 10 newest audit entries. Nothing is counted for hidden pages.
 */
export function createDashboard(deps: {
  counts: Pick<SqlDashboardCounts, "count">;
  listAudit: (query: AuditListQuery) => Promise<{ items: AuditEvent[] }>;
  /** Officers of the active period who graduated (B5): for whoever may end appointments. */
  graduatedOfficers: () => Promise<GraduatedOfficer[]>;
  /** Accounts holding the LPJ secretariat desk globally (none = LPJs cannot be reviewed). */
  lpjSecretariatHolders: () => Promise<number>;
}) {
  return async (principal: Principal) => {
    const visible = DASHBOARD_COUNTERS.filter((c) => canInSomeScope(principal, c.permission));
    // Whoever can fix it (roles) or depends on it (LPJ desks, programme approvers).
    const watchesLpj =
      can(principal, "roles.edit") ||
      canInSomeScope(principal, "lpj.read") ||
      canInSomeScope(principal, "programs.approve");
    const [values, audit, graduated, secretariat] = await Promise.all([
      Promise.all(visible.map((c) => deps.counts.count(c.key))),
      can(principal, "audit.read") ? deps.listAudit({ limit: 10 }) : null,
      can(principal, "appointments.edit") ? deps.graduatedOfficers() : null,
      watchesLpj ? deps.lpjSecretariatHolders() : null,
    ]);
    return {
      counters: visible.map((c, i) => ({ ...c, value: values[i] as number })),
      audit: audit ? audit.items : null,
      graduatedOfficers: graduated,
      /** True when nobody holds the LPJ secretariat desk (shown as a warning). */
      noLpjSecretariat: secretariat === 0,
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
