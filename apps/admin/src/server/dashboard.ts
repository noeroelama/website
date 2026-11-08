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

export function createDashboard(deps: {
  counts: Pick<SqlDashboardCounts, "count">;
  listAudit: (query: AuditListQuery) => Promise<{ items: AuditEvent[] }>;
  graduatedOfficers: () => Promise<GraduatedOfficer[]>;
  lpjSecretariatHolders: () => Promise<number>;
  activePeriod: () => Promise<{ id: string; name: string } | null>;
  finance: (periodId: string) => Promise<FinanceRequest[]>;
  lpj: (periodId: string) => Promise<LpjReport[]>;
  programs: (periodId: string) => Promise<Program[]>;
  zoom: (from: Date) => Promise<ZoomRequest[]>;
  agenda: (principal: Principal, from: Date, to: Date) => Promise<CalendarItem[]>;
  myTasks: (uid: string) => Promise<Task[]>;
  now: () => Date;
}) {
  return async (principal: Principal) => {
    const visible = DASHBOARD_COUNTERS.filter((c) => canInSomeScope(principal, c.permission));
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
      queues: queues.map((q) => ({
        label: q.label,
        href: q.href,
        count: sources[q.source].filter(
          (item) =>
            can(principal, q.permission, { orgUnitPath: item.orgUnitPath }) &&
            q.waiting(item, principal.userId, now),
        ).length,
      })),
      agenda,
      deadlines: tasks.filter((t) => !t.done && t.due !== null && t.due <= twoWeeks),
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
      noLpjSecretariat: secretariat === 0,
    };
  };
}

export interface GraduatedOfficer {
  readonly name: string;
  readonly title: string;
  readonly graduatedOn: string;
  readonly periodId: string;
}
