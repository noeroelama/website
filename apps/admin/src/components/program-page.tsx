"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HealthStatus, ProgramStatus } from "@website/domain/programs";
import {
  approveProgramAction,
  cancelProgramAction,
  checkInAction,
  deleteMilestoneAction,
  finishProgramAction,
  markMilestoneAction,
  returnProgramAction,
  saveMilestoneAction,
  setHealthAction,
  startProgramAction,
} from "@/app/(panel)/programs/actions";
import { actionMessage } from "@/components/action-message";
import {
  ChoiceField,
  Field,
  FormModal,
  num,
  text,
  type ActionResult,
} from "@/components/program-ui";
import {
  HEALTH_TONE,
  PlanForm,
  type PlanOptions,
  type PlanValues,
} from "@/components/programs-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { HEALTH_STATUS_LABELS, label, PROGRAM_STATUS_LABELS } from "@/labels";

interface MilestoneItem {
  id: string;
  title: string;
  dueOn: string | null;
  weight: number;
  sort: number;
  done: boolean;
}
interface Props {
  program: {
    id: string;
    version: number;
    periodId: string;
    name: string;
    goal: string;
    description: string;
    status: ProgramStatus;
    progress: number;
    unitName: string;
    keyResult: string | null;
    planned: string;
    budgets: string[];
    pics: string[];
    health: { status: HealthStatus; reason: string; at: string } | null;
    reviewNote: string | null;
    cancelReason: string | null;
    milestones: MilestoneItem[];
  };
  plan: PlanValues;
  options: PlanOptions | null;
  checkins: Array<{
    id: string;
    weekStart: string;
    achievements: string;
    blockers: string;
    nextPlan: string;
  }>;
  can: { approve: boolean; manage: boolean; checkIn: boolean };
}

type Dialog =
  "plan" | "return" | "cancel" | "health" | "checkin" | { milestone: MilestoneItem | null };

export function ProgramPage({ program, plan, options, checkins, can }: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const ref = { id: program.id, version: program.version };
  const { status } = program;

  const run = async (action: Promise<ActionResult>, message: string) => {
    const result = await action;
    if (!result.ok) return toast.show(actionMessage(result));
    toast.show(message);
    router.refresh();
  };
  const milestone = typeof dialog === "object" && dialog ? dialog.milestone : null;

  const columns: Column<MilestoneItem>[] = [
    {
      key: "check",
      header: "",
      width: "48px",
      render: (m) => (
        <input
          type="checkbox"
          aria-label={`${m.title} done`}
          checked={m.done}
          disabled={!can.manage}
          onChange={(e) =>
            void run(
              markMilestoneAction({ ...ref, milestoneId: m.id, done: e.target.checked }),
              e.target.checked ? "Milestone done" : "Milestone opened again",
            )
          }
        />
      ),
    },
    {
      key: "title",
      header: "Milestone",
      render: (m) => (
        <div>
          <div className="admin-table__title">{m.title}</div>
          <div className="admin-table__sub">
            Weight {m.weight}
            {m.dueOn ? ` · due ${m.dueOn}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (m) =>
        can.manage ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-btn--icon-danger"
              title="Delete"
              aria-label={`Delete ${m.title}`}
              onClick={() =>
                void run(deleteMilestoneAction({ ...ref, milestoneId: m.id }), "Milestone deleted")
              }
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              title="Edit"
              aria-label={`Edit ${m.title}`}
              onClick={() => setDialog({ milestone: m })}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">{program.name}</h1>
          <p className="admin-page-header__desc">
            {program.unitName} · <Badge>{label(PROGRAM_STATUS_LABELS, status)}</Badge> ·{" "}
            {program.progress}% done
          </p>
        </div>
        <div className="admin-page-header__actions">
          {options ? (
            <Button variant="outline" size="sm" icon="edit" onClick={() => setDialog("plan")}>
              Edit plan
            </Button>
          ) : null}
          {can.approve && status === "proposed" ? (
            <Button
              size="sm"
              icon="check"
              onClick={() => run(approveProgramAction(ref), "Approved")}
            >
              Approve
            </Button>
          ) : null}
          {can.approve && (status === "proposed" || status === "approved") ? (
            <Button variant="outline" size="sm" icon="undo" onClick={() => setDialog("return")}>
              Return
            </Button>
          ) : null}
          {can.manage && status === "approved" ? (
            <Button size="sm" onClick={() => run(startProgramAction(ref), "Started")}>
              Start
            </Button>
          ) : null}
          {can.manage && status === "running" ? (
            <Button size="sm" onClick={() => run(finishProgramAction(ref), "Finished")}>
              Finish
            </Button>
          ) : null}
          {can.approve && status !== "finished" && status !== "cancelled" ? (
            <Button variant="danger" size="sm" onClick={() => setDialog("cancel")}>
              Cancel programme
            </Button>
          ) : null}
          {status === "finished" ? (
            <Button variant="outline" size="sm" icon="note" href={`/lpj/${program.id}`}>
              LPJ
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            href={`/programs?period=${program.periodId}`}
          >
            Back
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Plan" />
        <CardBody>
          {program.reviewNote ? <p>Returned: {program.reviewNote}</p> : null}
          {program.cancelReason ? <p>Cancelled: {program.cancelReason}</p> : null}
          <p>Key result: {program.keyResult ?? "none"}</p>
          <p>Goal: {program.goal || "—"}</p>
          <p style={{ whiteSpace: "pre-line" }}>{program.description}</p>
          <p>Planned: {program.planned || "—"}</p>
          <p>Budget: {program.budgets.join(" · ") || "—"}</p>
          <p>PICs: {program.pics.join(", ") || "none yet"}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Health"
          subtitle={
            program.health ? (
              <>
                <Badge tone={HEALTH_TONE[program.health.status]}>
                  {label(HEALTH_STATUS_LABELS, program.health.status)}
                </Badge>{" "}
                {program.health.reason} · {program.health.at}
              </>
            ) : (
              "Not reported yet"
            )
          }
          actions={
            can.checkIn ? (
              <Button variant="outline" size="sm" icon="edit" onClick={() => setDialog("health")}>
                Update health
              </Button>
            ) : null
          }
        />
      </Card>

      <Card className="admin-events-card">
        <CardHeader
          title="Milestones"
          subtitle="Progress is the weight of the milestones done; it is never typed."
          actions={
            can.manage ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                onClick={() => setDialog({ milestone: null })}
              >
                Add milestone
              </Button>
            ) : null
          }
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={program.milestones}
            rowKey={(m) => m.id}
            emptyText="No milestones yet."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Weekly check-ins"
          subtitle="One per week (weeks start Monday 00:00 UTC); sending again updates this week's."
          actions={
            can.checkIn ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setDialog("checkin")}>
                Check in this week
              </Button>
            ) : null
          }
        />
        <CardBody>
          {checkins.length === 0 ? <p>No check-ins yet.</p> : null}
          {checkins.map((c) => (
            <div key={c.id} className="admin-field">
              <div className="admin-table__title">Week of {c.weekStart}</div>
              <p style={{ whiteSpace: "pre-line" }}>{c.achievements}</p>
              {c.blockers ? <p>Blockers: {c.blockers}</p> : null}
              {c.nextPlan ? <p>Next: {c.nextPlan}</p> : null}
            </div>
          ))}
        </CardBody>
      </Card>

      {options ? (
        <PlanForm
          open={dialog === "plan"}
          onClose={() => setDialog(null)}
          periodId={program.periodId}
          options={options}
          current={plan}
        />
      ) : null}
      <FormModal
        open={dialog === "return" || dialog === "cancel"}
        title={dialog === "cancel" ? "Cancel this programme?" : "Return to the proposer"}
        submitLabel={dialog === "cancel" ? "Cancel programme" : "Return"}
        onClose={() => setDialog(null)}
        onSubmit={(form) =>
          (dialog === "cancel" ? cancelProgramAction : returnProgramAction)({
            ...ref,
            note: text(form, "note"),
          })
        }
      >
        <Field
          label={dialog === "cancel" ? "Reason" : "What must be fixed"}
          name="note"
          rows={3}
          required
          maxLength={1000}
        />
      </FormModal>
      <FormModal
        open={dialog === "health"}
        title="Update health"
        onClose={() => setDialog(null)}
        onSubmit={(form) =>
          setHealthAction({ ...ref, health: text(form, "health"), reason: text(form, "reason") })
        }
      >
        <ChoiceField
          label="Health"
          name="health"
          defaultValue={program.health?.status ?? "on_track"}
          options={(["on_track", "at_risk", "off_track"] as const).map((h) => ({
            value: h,
            label: label(HEALTH_STATUS_LABELS, h),
          }))}
        />
        <Field label="Reason (always)" name="reason" rows={3} required maxLength={1000} />
      </FormModal>
      <FormModal
        key={`m-${milestone?.id ?? "new"}`}
        open={typeof dialog === "object" && dialog !== null}
        title={milestone ? "Edit milestone" : "Add milestone"}
        onClose={() => setDialog(null)}
        onSubmit={(form) =>
          saveMilestoneAction({
            ...ref,
            ...(milestone ? { milestoneId: milestone.id } : {}),
            title: text(form, "title"),
            dueOn: text(form, "dueOn") || null,
            weight: num(form, "weight"),
            sort: num(form, "sort"),
          })
        }
      >
        <Field
          label="Milestone"
          name="title"
          required
          minLength={2}
          maxLength={200}
          defaultValue={milestone?.title ?? ""}
        />
        <Field label="Due on" name="dueOn" type="date" defaultValue={milestone?.dueOn ?? ""} />
        <Field
          label="Weight (1-100)"
          name="weight"
          type="number"
          min={1}
          max={100}
          required
          defaultValue={milestone?.weight ?? 1}
        />
        <Field
          label="Order"
          name="sort"
          type="number"
          min={0}
          max={999}
          defaultValue={milestone?.sort ?? 0}
        />
      </FormModal>
      <FormModal
        open={dialog === "checkin"}
        title="Check in this week"
        onClose={() => setDialog(null)}
        onSubmit={(form) =>
          checkInAction({
            id: program.id,
            achievements: text(form, "achievements"),
            blockers: text(form, "blockers"),
            nextPlan: text(form, "nextPlan"),
          })
        }
      >
        <Field
          label="What was done this week"
          name="achievements"
          rows={3}
          required
          maxLength={2000}
        />
        <Field label="Blockers" name="blockers" rows={2} maxLength={2000} />
        <Field label="Next week" name="nextPlan" rows={2} maxLength={2000} />
      </FormModal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
