import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { notFound } from "next/navigation";
import { inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { formatMoney, isClosed, isUnderway } from "@website/domain/programs";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { ProgramPage } from "@/components/program-page";
import { canManageProgram } from "@/server/programs";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** One programme (E2, E3): plan, workflow, milestones, health and weekly check-ins. */
export default async function ProgramRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/programs/${id}`, "programs.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  if (!safeId.safeParse(id).success) notFound();
  const program = await adminReads.getProgram(id);
  if (!program || program.deletedAt) notFound();
  const scope = { orgUnitPath: program.orgUnitPath };
  if (!can(principal, "programs.read", scope)) notFound();
  const [units, objectives, checkins, people] = await Promise.all([
    adminReads.listOrgUnits(program.periodId),
    adminReads.listObjectives(program.periodId),
    adminReads.listCheckins(program.id),
    adminReads.getUsers(program.pics),
  ]);
  const objective = objectives.find((o) => o.id === program.objectiveId);
  const keyResult = objective?.keyResults.find((kr) => kr.id === program.keyResultId);
  const open = !isClosed(program.status);
  const manage = canManageProgram(principal, program);
  const canPlan = open && can(principal, "programs.edit", scope);
  return (
    <>
      <WorkflowGuide id="programs" flow={WORKFLOWS.programs} current={program.status} />
      <ProgramPage
        program={{
          id: program.id,
          version: program.version,
          periodId: program.periodId,
          name: program.name,
          goal: program.goal,
          description: program.description,
          status: program.status,
          progress: program.progressPercent,
          unitName: units.find((u) => u.id === program.orgUnitId)?.name ?? "",
          keyResult: keyResult && objective ? `${objective.title} → ${keyResult.title}` : null,
          planned: [program.plannedStart, program.plannedEnd].filter(Boolean).join(" – "),
          budgets: program.budgets.map(formatMoney),
          pics: program.pics.map((uid) => people.get(uid)?.name ?? people.get(uid)?.email ?? uid),
          health: program.health && {
            status: program.health.status,
            reason: program.health.reason,
            at: formatUtc(program.health.at),
          },
          reviewNote: program.reviewNote,
          cancelReason: program.cancelReason,
          milestones: program.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            dueOn: m.dueOn,
            weight: m.weight,
            sort: m.sort,
            done: m.completedAt !== null,
          })),
        }}
        plan={{
          id: program.id,
          version: program.version,
          name: program.name,
          goal: program.goal,
          description: program.description,
          orgUnitId: program.orgUnitId,
          objectiveId: program.objectiveId,
          keyResultId: program.keyResultId,
          plannedStart: program.plannedStart,
          plannedEnd: program.plannedEnd,
          budgets: [...program.budgets],
          picEmails: program.pics.map((uid) => people.get(uid)?.email ?? "").filter(Boolean),
        }}
        options={
          canPlan
            ? {
                units: inTreeOrder(units)
                  .filter(
                    (u) =>
                      !u.deletedAt &&
                      can(principal, "programs.edit", { orgUnitPath: orgUnitPath(u) }),
                  )
                  .map((u) => ({ id: u.id, name: u.name })),
                keyResults: objectives.flatMap((o) =>
                  o.keyResults.map((kr) => ({
                    value: `${o.id}:${kr.id}`,
                    label: `${o.title} → ${kr.title}`,
                  })),
                ),
              }
            : null
        }
        checkins={checkins.map((c) => ({
          id: c.id,
          weekStart: c.weekStart,
          achievements: c.achievements,
          blockers: c.blockers,
          nextPlan: c.nextPlan,
        }))}
        can={{
          approve: can(principal, "programs.approve", scope),
          manage: manage && open,
          checkIn: manage && isUnderway(program.status),
        }}
      />
    </>
  );
}
