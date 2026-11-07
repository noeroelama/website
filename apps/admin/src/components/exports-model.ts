import type { MeetingRole } from "@website/domain/meetings";
import { MEETING_ROLE_LABELS } from "@website/domain/meetings";
import type { HealthStatus, ProgramStatus } from "@website/domain/programs";
import { HEALTH_STATUS_LABELS, label, PROGRAM_STATUS_LABELS } from "../labels";
import { esc } from "./format";

// Export CSVs (M8): rows already on the page, cells quoted with `esc` for `downloadCsv`, UTC times.

const utc = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
const table = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  [header, ...rows].map((r) => r.map(esc));

/** Programmes with their milestones: one row per milestone (or one for a programme without). */
export function programsCsv(
  rows: ReadonlyArray<{
    name: string;
    unitName: string;
    status: ProgramStatus;
    progress: number;
    health: HealthStatus | null;
    milestones: ReadonlyArray<{ title: string; dueOn: string | null; done: boolean }>;
  }>,
): string[][] {
  return table(
    ["Programme", "Unit", "Status", "Progress %", "Health", "Milestone", "Due", "Done"],
    rows.flatMap((p) => {
      const head = [
        p.name,
        p.unitName,
        label(PROGRAM_STATUS_LABELS, p.status),
        String(p.progress),
        p.health ? label(HEALTH_STATUS_LABELS, p.health) : "",
      ];
      return p.milestones.length
        ? p.milestones.map((m) => [...head, m.title, m.dueOn ?? "", m.done ? "yes" : "no"])
        : [[...head, "", "", ""]];
    }),
  );
}

export function zoomCsv(
  rows: ReadonlyArray<{
    topic: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    status: string;
    requester: string;
  }>,
): string[][] {
  return table(
    ["Topic", "Start (UTC)", "End (UTC)", "Time zone", "Status", "Requested by"],
    rows.map((z) => [z.topic, utc(z.startsAt), utc(z.endsAt), z.timeZone, z.status, z.requester]),
  );
}

export function attendanceCsv(
  rows: ReadonlyArray<{
    name: string;
    role: MeetingRole;
    presentAt: string | null;
    method: string | null;
  }>,
): string[][] {
  return table(
    ["Name", "Role", "Attendance", "Signed at (UTC)", "Method"],
    rows.map((p) => [
      p.name,
      MEETING_ROLE_LABELS[p.role],
      p.presentAt ? "present" : "absent",
      utc(p.presentAt),
      p.method ?? "",
    ]),
  );
}

export function applicantsCsv(
  rows: ReadonlyArray<{
    name: string;
    email: string;
    statusLabel: string;
    choices: ReadonlyArray<{ name: string }>;
    submittedAt: string | null;
    offer: { unitName: string } | null;
    personality: { full: string } | null;
  }>,
): string[][] {
  return table(
    ["Name", "E-mail", "Status", "Choices", "Submitted (UTC)", "Offered unit", "Personality"],
    rows.map((a) => [
      a.name,
      a.email,
      a.statusLabel,
      a.choices.map((c) => c.name).join("; "),
      utc(a.submittedAt),
      a.offer?.unitName ?? "",
      a.personality?.full ?? "",
    ]),
  );
}

/** Accounts with their role assignments (website role and organisational roles by name). */
export function peopleCsv(
  rows: ReadonlyArray<{
    name: string;
    email: string | null;
    status: string;
    createdAt: string | null;
    lastSignInAt: string | null;
    roleId: string | null;
    orgRoleIds: readonly string[];
  }>,
  roleNames: ReadonlyMap<string, string>,
): string[][] {
  const role = (id: string) => roleNames.get(id) ?? id;
  return table(
    [
      "Name",
      "E-mail",
      "Status",
      "Created (UTC)",
      "Last sign-in (UTC)",
      "Website role",
      "Org roles",
    ],
    rows.map((p) => [
      p.name,
      p.email ?? "",
      p.status,
      utc(p.createdAt),
      utc(p.lastSignInAt),
      p.roleId ? role(p.roleId) : "",
      p.orgRoleIds.map(role).join("; "),
    ]),
  );
}
