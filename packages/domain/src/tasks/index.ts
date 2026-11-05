import type { IncomingLetter } from "../documents";
import type { ActionItem } from "../meetings";
import type { Program } from "../programs";

/**
 * My Tasks and unit task boards (G1), ported from PPIDK `Tugas/*`: a READ MODEL (no tasks
 * collection) over meeting action items, incoming-letter dispositions and programme milestones.
 * Work is completed in the source module; "overdue" is computed at read time.
 */

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
  /** Where it comes from ("Rapat kerja", "042/AG/VIII/2026", "Webinar"). */
  readonly source: string;
  readonly due: string | null;
  readonly done: boolean;
  readonly overdue: boolean;
  /** The admin page that completes it; shown only to viewers who may open that page. */
  readonly href: string;
  /** Scope of the source record (who may open the link). */
  readonly orgUnitPath: readonly string[];
  /** The module permission that opens `href`. */
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

/** Dispositions addressed to the person, or to one of the units (unit boards). */
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
        href: `/incoming`,
        orgUnitPath: d.toOrgUnitId ? unitPathOf(d.toOrgUnitId) : [],
        page: "incoming" as const,
      })),
  );
}

/** Milestones of running or approved programmes. */
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

/** Open first, then by due date (no date last), then title. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.title.localeCompare(b.title),
  );
}

/** `taskBoardShares/{orgUnitId}_{uid}`: a unit board shared with one person, view only. */
export const boardShareId = (orgUnitId: string, uid: string) => `${orgUnitId}_${uid}`;
