import "server-only";
import type { AuditEvent } from "@website/audit";
import type { DashboardCounter, SqlDashboardCounts } from "@website/db/sql";
import type { AuditListQuery } from "@website/db/sql";
import { authorizeRequest, reviewRequest, type FinanceRequest } from "@website/domain/finance";
import {
  LPJ_DESK_PERMISSIONS,
  LPJ_DESKS,
  signLpj,
  type LpjReport,
  type Program,
} from "@website/domain/programs";
import type { CalendarItem, Task } from "@website/domain/tasks";
import type { ZoomRequest } from "@website/domain/zoom";
import { can, canInSomeScope, type PagePermission, type Principal } from "@website/permissions";

const DAY = 86_400_000;

/** True when the domain rule lets this person take the step now (the same rule the action runs). */
const allowed = (step: () => unknown) => {
  try {
    step();
    return true;
  } catch {
    return false;
  }
};

interface QueueSources {
  finance: FinanceRequest[];
  lpj: LpjReport[];
  zoom: ZoomRequest[];
}
type Waiting<K extends keyof QueueSources> = (
  item: QueueSources[K][number],
  uid: string,
  now: Date,
) => boolean;
interface Queue<K extends keyof QueueSources> {
  readonly label: string;
  readonly href: string;
  readonly permission: PagePermission;
  readonly source: K;
  readonly waiting: Waiting<K>;
}
const queue = <K extends keyof QueueSources>(q: Queue<K>) =>
  q as unknown as Queue<keyof QueueSources>;

/**
 * "Waiting for my action": a desk counts an item only when its permission covers the item's unit
 * AND the module's own rule would let this person act now (not the requester, not a second desk).
 */
export const DASHBOARD_QUEUES = [
  queue({
    label: "Finance requests to review",
    href: "/finance",
    permission: "finance.review",
    source: "finance",
    waiting: (r, uid, now) => allowed(() => reviewRequest(r, uid, "", now)),
  }),
  queue({
    label: "Finance requests to authorise",
    href: "/finance",
    permission: "finance.authorize",
    source: "finance",
    waiting: (r, uid, now) => allowed(() => authorizeRequest(r, uid, "", now)),
  }),
  queue({
    label: "Finance requests to pay",
    href: "/finance",
    permission: "finance.pay",
    source: "finance",
    waiting: (r, uid) => r.status === "authorized" && r.createdBy !== uid,
  }),
  ...LPJ_DESKS.map((desk) =>
    queue({
      label: {
        secretariat: "LPJs to check (secretariat)",
        treasurer: "LPJs to check (treasurer)",
        approval: "LPJs to approve",
      }[desk],
      href: "/lpj",
      permission: LPJ_DESK_PERMISSIONS[desk],
      source: "lpj",
      waiting: (l, uid, now) => allowed(() => signLpj(l, desk, uid, now)),
    }),
  ),
  queue({
    label: "Zoom bookings to approve",
    href: "/zoom",
    permission: "zoom.approve",
    source: "zoom",
    waiting: (z, _uid, now) => z.status === "pending" && z.startsAt > now,
  }),
];

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
  activePeriod: () => Promise<{ id: string; name: string } | null>;
  finance: (periodId: string) => Promise<FinanceRequest[]>;
  lpj: (periodId: string) => Promise<LpjReport[]>;
  programs: (periodId: string) => Promise<Program[]>;
  /** Bookings from now on (pending ones are the approval queue). */
  zoom: (from: Date) => Promise<ZoomRequest[]>;
  /** The calendar read model (G2): the same items as the Calendar page. */
  agenda: (principal: Principal, from: Date, to: Date) => Promise<CalendarItem[]>;
  /** My Tasks (G1). */
  myTasks: (uid: string) => Promise<Task[]>;
  now: () => Date;
}) {
  return async (principal: Principal) => {
    const visible = DASHBOARD_COUNTERS.filter((c) => canInSomeScope(principal, c.permission));
    // Whoever can fix it (roles) or depends on it (LPJ desks, programme approvers).
    const watchesLpj =
      can(principal, "roles.edit") ||
      canInSomeScope(principal, "lpj.read") ||
      canInSomeScope(principal, "programs.approve");
    const now = deps.now();
    const queues = DASHBOARD_QUEUES.filter((q) => canInSomeScope(principal, q.permission));
    const uses = (source: keyof QueueSources) => queues.some((q) => q.source === source);
    const seesPrograms = canInSomeScope(principal, "programs.read");
    const period = await deps.activePeriod();
    const [values, audit, graduated, secretariat, finance, lpj, zoom, programs, agenda, tasks] =
      await Promise.all([
        Promise.all(visible.map((c) => deps.counts.count(c.key))),
        can(principal, "audit.read") ? deps.listAudit({ limit: 10 }) : null,
        can(principal, "appointments.edit") ? deps.graduatedOfficers() : null,
        watchesLpj ? deps.lpjSecretariatHolders() : null,
        period && uses("finance") ? deps.finance(period.id) : [],
        period && uses("lpj") ? deps.lpj(period.id) : [],
        uses("zoom") ? deps.zoom(now) : [],
        period && seesPrograms ? deps.programs(period.id) : [],
        canInSomeScope(principal, "calendar.read")
          ? deps.agenda(principal, now, new Date(now.getTime() + 7 * DAY))
          : null,
        deps.myTasks(principal.userId),
      ]);
    const sources: QueueSources = { finance, lpj, zoom };
    const twoWeeks = new Date(now.getTime() + 14 * DAY).toISOString().slice(0, 10);
    const mine = programs.filter((p) =>
      can(principal, "programs.read", { orgUnitPath: p.orgUnitPath }),
    );
    return {
      /** Each desk the viewer holds, with what waits there in the units it covers. */
      queues: queues.map((q) => ({
        label: q.label,
        href: q.href,
        count: sources[q.source].filter(
          (item) =>
            can(principal, q.permission, { orgUnitPath: item.orgUnitPath }) &&
            q.waiting(item, principal.userId, now),
        ).length,
      })),
      /** The next 7 days of the calendar (null without calendar.read). */
      agenda,
      /** My open tasks due within 2 weeks, overdue ones included. */
      deadlines: tasks.filter((t) => !t.done && t.due !== null && t.due <= twoWeeks),
      /** The active period's programmes the viewer can read. */
      period:
        period && seesPrograms
          ? {
              name: period.name,
              programs: mine.length,
              running: mine.filter((p) => p.status === "running").length,
            }
          : null,
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
