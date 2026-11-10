import type { IncomingLetter } from "../documents";
import type { ActionItem } from "../meetings";
import type { Program } from "../programs";

export type TaskKind = "action" | "disposition" | "milestone";
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  action: "Meeting follow-up",
  disposition: "Letter disposition",
  milestone: "Programme milestone",
};

export interface Task {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  readonly source: string;
  readonly due: string | null;
  readonly done: boolean;
  readonly overdue: boolean;
  readonly href: string;
  readonly orgUnitPath: readonly string[];
  readonly page: "meetings" | "incoming" | "programs";
}

const overdue = (due: string | null, done: boolean, today: string) =>
  !done && due !== null && due < today;

export function actionTasks(items: readonly ActionItem[], today: string): Task[] {
  return items.map((a) => ({
    id: `action:${a.id}`,
    kind: "action",
    title: a.title,
    source: a.meetingTitle,
    due: a.dueOn,
    done: a.doneAt !== null,
    overdue: overdue(a.dueOn, a.doneAt !== null, today),
    href: `/meetings/${a.meetingId}`,
    orgUnitPath: a.orgUnitPath,
    page: "meetings",
  }));
}

export function dispositionTasks(
  letters: readonly IncomingLetter[],
  to: { userId?: string; orgUnitIds: readonly string[] },
  unitPathOf: (orgUnitId: string) => readonly string[],
  today: string,
): Task[] {
  return letters.flatMap((letter) =>
    letter.dispositions
      .filter(
        (d) =>
          (to.userId !== undefined && d.toUserId === to.userId) ||
          (d.toOrgUnitId !== null && to.orgUnitIds.includes(d.toOrgUnitId)),
      )
      .map((d) => ({
        id: `disposition:${letter.id}:${d.id}`,
        kind: "disposition" as const,
        title: d.instruction,
        source: `${letter.agendaNumber} ${letter.subject}`,
        due: d.dueDate,
        done: d.status === "done",
        overdue: overdue(d.dueDate, d.status === "done", today),
        href: "/letters?tab=incoming",
        orgUnitPath: d.toOrgUnitId ? unitPathOf(d.toOrgUnitId) : [],
        page: "incoming" as const,
      })),
  );
}

export function milestoneTasks(programs: readonly Program[], today: string): Task[] {
  return programs
    .filter((p) => p.status === "approved" || p.status === "running")
    .flatMap((p) =>
      p.milestones.map((m) => ({
        id: `milestone:${p.id}:${m.id}`,
        kind: "milestone" as const,
        title: m.title,
        source: p.name,
        due: m.dueOn,
        done: m.completedAt !== null,
        overdue: overdue(m.dueOn, m.completedAt !== null, today),
        href: `/programs/${p.id}`,
        orgUnitPath: p.orgUnitPath,
        page: "programs" as const,
      })),
    );
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.title.localeCompare(b.title),
  );
}

export const boardShareId = (orgUnitId: string, uid: string) => `${orgUnitId}_${uid}`;
export * from "./calendar";
