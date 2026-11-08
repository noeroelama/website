import "server-only";
import { z } from "zod";
import type { SqlTaskShareStore } from "@website/db/sql";
import type { IncomingLetter } from "@website/domain/documents";
import type { ActionItem } from "@website/domain/meetings";
import type { Program } from "@website/domain/programs";
import {
  actionTasks,
  dispositionTasks,
  milestoneTasks,
  sortTasks,
  type Task,
} from "@website/domain/tasks";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface TaskDeps {
  readonly activePeriod: () => Promise<{ id: string } | null>;
  readonly actionItemsOf: (uid: string) => Promise<ActionItem[]>;
  readonly actionItemsOfPeriod: (periodId: string) => Promise<ActionItem[]>;
  readonly incoming: (periodId: string) => Promise<IncomingLetter[]>;
  readonly programs: (periodId: string) => Promise<Program[]>;
  readonly unitsOf: (uid: string) => Promise<string[]>;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly shares: Pick<SqlTaskShareStore, "has" | "set">;
  readonly findUserId: (email: string) => Promise<string | null>;
  readonly now: () => Date;
}

export const visibleTask = (principal: Principal, task: Task) => ({
  ...task,
  href: can(principal, `${task.page}.read`, { orgUnitPath: task.orgUnitPath }) ? task.href : null,
});

export function createTasks(deps: TaskDeps) {
  const today = () => deps.now().toISOString().slice(0, 10);
  const paths = async (ids: readonly string[]) => {
    const map = new Map<string, readonly string[]>();
    for (const id of new Set(ids)) map.set(id, (await deps.unitPath(id)) ?? [id]);
    return map;
  };

  async function mine(uid: string): Promise<Task[]> {
    const period = await deps.activePeriod();
    const [items, letters, programs, units] = await Promise.all([
      deps.actionItemsOf(uid),
      period ? deps.incoming(period.id) : Promise.resolve([]),
      period ? deps.programs(period.id) : Promise.resolve([]),
      deps.unitsOf(uid),
    ]);
    const unitPaths = await paths(
      letters.flatMap((l) => l.dispositions.flatMap((d) => (d.toOrgUnitId ? [d.toOrgUnitId] : []))),
    );
    return sortTasks([
      ...actionTasks(items, today()),
      ...dispositionTasks(
        letters,
        { userId: uid, orgUnitIds: units },
        (id) => unitPaths.get(id) as readonly string[],
        today(),
      ),
      ...milestoneTasks(
        programs.filter((p) => p.pics.includes(uid)),
        today(),
      ),
    ]);
  }

  async function board(principal: Principal, orgUnitId: string): Promise<Task[] | null> {
    const path = await deps.unitPath(orgUnitId);
    if (!path) return null;
    const allowed =
      can(principal, "tasks.read", { orgUnitPath: path }) ||
      (await deps.shares.has(orgUnitId, principal.userId));
    const period = await deps.activePeriod();
    if (!allowed || !period) return null;
    const [items, letters, programs] = await Promise.all([
      deps.actionItemsOfPeriod(period.id),
      deps.incoming(period.id),
      deps.programs(period.id),
    ]);
    const inUnit = (p: readonly string[]) => p.includes(orgUnitId);
    const targets = letters.flatMap((l) =>
      l.dispositions.flatMap((d) => (d.toOrgUnitId ? [d.toOrgUnitId] : [])),
    );
    const unitPaths = await paths(targets);
    const below = [...unitPaths].filter(([, p]) => inUnit(p)).map(([id]) => id);
    return sortTasks([
      ...actionTasks(
        items.filter((a) => inUnit(a.orgUnitPath)),
        today(),
      ),
      ...dispositionTasks(
        letters,
        { orgUnitIds: below },
        (id) => unitPaths.get(id) as readonly string[],
        today(),
      ),
      ...milestoneTasks(
        programs.filter((p) => inUnit(p.orgUnitPath)),
        today(),
      ),
    ]);
  }

  const share = createGuardedAction({
    permission: "tasks.share",
    input: z
      .object({
        orgUnitId: safeId,
        email: z.email("Enter the person's account e-mail.").max(254),
        shared: z.boolean(),
      })
      .strict(),
    resource: async ({ orgUnitId }) => ({ orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [] }),
    handler: async ({ orgUnitId, email, shared }, principal, audit) => {
      const uid = await deps.findUserId(email.toLowerCase());
      if (!uid) throw new RuleViolationError(`No account uses ${email}.`);
      await deps.shares.set(
        orgUnitId,
        uid,
        shared,
        principal.userId,
        deps.now(),
        audit({
          module: "tasks",
          action: shared ? "CREATE" : "DELETE",
          resourceType: "taskBoardShare",
          resourceId: `${orgUnitId}_${uid}`,
          title: email,
          before: shared ? null : { orgUnitId, uid },
          after: shared ? { orgUnitId, uid } : null,
          versionBefore: null,
          versionAfter: null,
          revertible: false,
        }),
      );
      return { uid, shared };
    },
  });

  return { mine, board, share };
}
