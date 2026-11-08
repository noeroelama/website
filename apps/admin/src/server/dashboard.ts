import "server-only";
import { authorizeRequest, reviewRequest, type FinanceRequest } from "@website/domain/finance";
import { LPJ_DESK_PERMISSIONS, LPJ_DESKS, signLpj, type LpjReport } from "@website/domain/programs";
import type { Task } from "@website/domain/tasks";
import type { ZoomRequest } from "@website/domain/zoom";
import { can, canInSomeScope, type PagePermission, type Principal } from "@website/permissions";

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

export function createDashboard(deps: {
  graduatedOfficers: () => Promise<GraduatedOfficer[]>;
  lpjSecretariatHolders: () => Promise<number>;
  activePeriod: () => Promise<{ id: string; name: string } | null>;
  finance: (periodId: string) => Promise<FinanceRequest[]>;
  lpj: (periodId: string) => Promise<LpjReport[]>;
  zoom: (from: Date) => Promise<ZoomRequest[]>;
  myTasks: (uid: string) => Promise<Task[]>;
  now: () => Date;
}) {
  return async (principal: Principal) => {
    const watchesLpj =
      can(principal, "roles.edit") ||
      canInSomeScope(principal, "lpj.read") ||
      canInSomeScope(principal, "programs.approve");
    const now = deps.now();
    const queues = DASHBOARD_QUEUES.filter((q) => canInSomeScope(principal, q.permission));
    const uses = (source: keyof QueueSources) => queues.some((q) => q.source === source);
    const period = await deps.activePeriod();
    const [graduated, secretariat, finance, lpj, zoom, tasks] = await Promise.all([
      can(principal, "appointments.edit") ? deps.graduatedOfficers() : null,
      watchesLpj ? deps.lpjSecretariatHolders() : null,
      period && uses("finance") ? deps.finance(period.id) : [],
      period && uses("lpj") ? deps.lpj(period.id) : [],
      uses("zoom") ? deps.zoom(now) : [],
      deps.myTasks(principal.userId),
    ]);
    const sources: QueueSources = { finance, lpj, zoom };
    return {
      queues: queues
        .map((q) => ({
          label: q.label,
          href: q.href,
          count: sources[q.source].filter(
            (item) =>
              can(principal, q.permission, { orgUnitPath: item.orgUnitPath }) &&
              q.waiting(item, principal.userId, now),
          ).length,
        }))
        .filter((q) => q.count > 0),
      overdue: tasks.filter((t) => !t.done && t.overdue),
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
