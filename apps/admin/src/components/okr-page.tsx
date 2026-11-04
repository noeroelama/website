"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PeriodStatus } from "@website/domain/organizations";
import type { KeyResultDirection } from "@website/domain/programs";
import {
  deleteKeyResultAction,
  removeObjectiveAction,
  saveKeyResultAction,
  saveObjectiveAction,
  saveVisionAction,
} from "@/app/(panel)/okr/actions";
import { actionMessage } from "@/components/action-message";
import { ChoiceField, Field, FormModal, num, PeriodSwitch, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

interface KeyResultItem {
  id: string;
  title: string;
  unit: string;
  baseline: number;
  target: number;
  current: number;
  direction: KeyResultDirection;
  sort: number;
  percent: number;
}
interface ObjectiveItem {
  id: string;
  version: number;
  title: string;
  description: string;
  orgUnitId: string | null;
  sort: number;
  unitName: string;
  percent: number;
  canEdit: boolean;
  keyResults: KeyResultItem[];
}
interface Props {
  period: {
    id: string;
    version: number;
    name: string;
    status: PeriodStatus;
    vision: string;
    mission: string;
    /** Global okr.edit and the period is not archived (also: region objectives). */
    canEdit: boolean;
  } | null;
  periods: Array<{ id: string; name: string }>;
  objectives: ObjectiveItem[];
  /** Units the viewer may plan for (empty in an archived period). */
  units: Array<{ id: string; name: string }>;
}

type Editing =
  | { kind: "vision" }
  | { kind: "objective"; objective: ObjectiveItem | null }
  | { kind: "keyResult"; objective: ObjectiveItem; keyResult: KeyResultItem | null };
type Removing =
  | { kind: "objective"; objective: ObjectiveItem }
  | { kind: "keyResult"; objective: ObjectiveItem; keyResult: KeyResultItem };

const measure = (kr: KeyResultItem) =>
  `${kr.baseline} → ${kr.target}${kr.unit ? ` ${kr.unit}` : ""} (now ${kr.current})`;

/** OKR (E1): the period's vision and mission, its objectives and their key results. */
export function OkrPage({ period, periods, objectives, units }: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [busy, setBusy] = useState(false);

  if (!period) {
    return (
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">OKR</h1>
        <p className="admin-page-header__desc">Create a board period first (Organizations).</p>
      </div>
    );
  }
  const unitOptions = [
    ...(period.canEdit ? [{ value: "", label: "Region (no unit)" }] : []),
    ...units.map((u) => ({ value: u.id, label: u.name })),
  ];

  const remove = async (target: Removing) => {
    setBusy(true);
    const result =
      target.kind === "objective"
        ? await removeObjectiveAction({
            id: target.objective.id,
            version: target.objective.version,
          })
        : await deleteKeyResultAction({
            objectiveId: target.objective.id,
            version: target.objective.version,
            keyResultId: target.keyResult.id,
          });
    setBusy(false);
    setRemoving(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
  };

  const columns = (o: ObjectiveItem): Column<KeyResultItem>[] => [
    {
      key: "title",
      header: "Key result",
      width: "45%",
      render: (kr) => (
        <div>
          <div className="admin-table__title">{kr.title}</div>
          <div className="admin-table__sub">
            {measure(kr)}
            {kr.direction === "down" ? " · lower is better" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "percent",
      header: "Achieved",
      width: "20%",
      render: (kr) => <span className="admin-table__title">{kr.percent}%</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (kr) =>
        o.canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-btn--icon-danger"
              title="Delete"
              aria-label={`Delete ${kr.title}`}
              onClick={() => setRemoving({ kind: "keyResult", objective: o, keyResult: kr })}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              title="Edit"
              aria-label={`Edit ${kr.title}`}
              onClick={() => setEditing({ kind: "keyResult", objective: o, keyResult: kr })}
            />
          </div>
        ) : null,
    },
  ];

  const objective = editing?.kind === "objective" ? editing.objective : null;
  const kr = editing?.kind === "keyResult" ? editing.keyResult : null;

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">OKR</h1>
          <p className="admin-page-header__desc">
            Vision, mission, objectives and key results of period {period.name}
            {period.status === "archived" ? " · Archived period (read-only)" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <PeriodSwitch path="/okr" current={period.id} periods={periods} />
          <div className="admin-fab">
            {unitOptions.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                onClick={() => setEditing({ kind: "objective", objective: null })}
              >
                Add New Objective
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Vision and mission"
          actions={
            period.canEdit ? (
              <Button
                variant="outline"
                size="sm"
                icon="edit"
                onClick={() => setEditing({ kind: "vision" })}
              >
                Edit
              </Button>
            ) : null
          }
        />
        <CardBody>
          <p className="admin-table__title">Vision</p>
          <p style={{ whiteSpace: "pre-line" }}>{period.vision || "Not written yet."}</p>
          <p className="admin-table__title">Mission</p>
          <p style={{ whiteSpace: "pre-line" }}>{period.mission || "Not written yet."}</p>
        </CardBody>
      </Card>

      {objectives.length === 0 ? (
        <p className="admin-page-header__desc">No objectives in this period yet.</p>
      ) : null}
      {objectives.map((o) => (
        <Card key={o.id} className="admin-events-card">
          <CardHeader
            title={o.title}
            subtitle={
              <>
                {o.unitName} ·{" "}
                <Badge tone={o.percent >= 100 ? "success" : "neutral"}>{o.percent}%</Badge>
                {o.description ? ` · ${o.description}` : ""}
              </>
            }
            actions={
              o.canEdit ? (
                <div className="admin-table__actions">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="plus"
                    onClick={() => setEditing({ kind: "keyResult", objective: o, keyResult: null })}
                  >
                    Add Key Result
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    icon="edit"
                    title="Edit"
                    aria-label={`Edit ${o.title}`}
                    onClick={() => setEditing({ kind: "objective", objective: o })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    icon="trash"
                    className="admin-btn--icon-danger"
                    title="Delete"
                    aria-label={`Delete ${o.title}`}
                    onClick={() => setRemoving({ kind: "objective", objective: o })}
                  />
                </div>
              ) : null
            }
          />
          <CardBody flush>
            <DataTable
              columns={columns(o)}
              rows={o.keyResults}
              rowKey={(k) => k.id}
              emptyText="No key results yet."
            />
          </CardBody>
        </Card>
      ))}

      <FormModal
        open={editing?.kind === "vision"}
        title="Vision and mission"
        onClose={() => setEditing(null)}
        onSubmit={(form) =>
          saveVisionAction({
            periodId: period.id,
            version: period.version,
            vision: text(form, "vision"),
            mission: text(form, "mission"),
          })
        }
      >
        <Field
          label="Vision"
          name="vision"
          rows={3}
          maxLength={2000}
          defaultValue={period.vision}
        />
        <Field
          label="Mission"
          name="mission"
          rows={6}
          maxLength={4000}
          defaultValue={period.mission}
        />
      </FormModal>

      <FormModal
        key={`o-${objective?.id ?? "new"}`}
        open={editing?.kind === "objective"}
        title={objective ? "Edit objective" : "Add New Objective"}
        onClose={() => setEditing(null)}
        onSubmit={(form) =>
          saveObjectiveAction({
            ...(objective ? { id: objective.id } : {}),
            version: objective?.version ?? null,
            periodId: period.id,
            title: text(form, "title"),
            description: text(form, "description"),
            orgUnitId: text(form, "orgUnitId") || null,
            sort: num(form, "sort"),
          })
        }
      >
        <Field
          label="Objective"
          name="title"
          required
          minLength={2}
          maxLength={200}
          defaultValue={objective?.title ?? ""}
        />
        <Field
          label="Description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={objective?.description ?? ""}
        />
        <ChoiceField
          label="Unit"
          name="orgUnitId"
          defaultValue={objective?.orgUnitId ?? unitOptions[0]?.value ?? ""}
          options={unitOptions}
        />
        <Field
          label="Order"
          name="sort"
          type="number"
          min={0}
          max={999}
          defaultValue={objective?.sort ?? 0}
        />
      </FormModal>

      <FormModal
        key={`k-${kr?.id ?? "new"}`}
        open={editing?.kind === "keyResult"}
        title={kr ? "Edit key result" : "Add Key Result"}
        onClose={() => setEditing(null)}
        onSubmit={(form) => {
          const owner = (editing as Extract<Editing, { kind: "keyResult" }>).objective;
          return saveKeyResultAction({
            objectiveId: owner.id,
            version: owner.version,
            ...(kr ? { keyResultId: kr.id } : {}),
            title: text(form, "title"),
            unit: text(form, "unit"),
            baseline: num(form, "baseline"),
            target: num(form, "target"),
            current: num(form, "current"),
            direction: text(form, "direction"),
            sort: num(form, "sort"),
          });
        }}
      >
        <Field
          label="Key result"
          name="title"
          required
          minLength={2}
          maxLength={200}
          defaultValue={kr?.title ?? ""}
        />
        <Field
          label="Unit (people, events, %)"
          name="unit"
          maxLength={32}
          defaultValue={kr?.unit ?? ""}
        />
        <Field
          label="Baseline"
          name="baseline"
          type="number"
          step="any"
          required
          defaultValue={kr?.baseline ?? 0}
        />
        <Field
          label="Target"
          name="target"
          type="number"
          step="any"
          required
          defaultValue={kr?.target ?? ""}
        />
        <Field
          label="Current value"
          name="current"
          type="number"
          step="any"
          required
          defaultValue={kr?.current ?? 0}
        />
        <ChoiceField
          label="Direction"
          name="direction"
          defaultValue={kr?.direction ?? "up"}
          options={[
            { value: "up", label: "Higher is better" },
            { value: "down", label: "Lower is better" },
          ]}
        />
        <Field
          label="Order"
          name="sort"
          type="number"
          min={0}
          max={999}
          defaultValue={kr?.sort ?? 0}
        />
      </FormModal>

      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.kind === "keyResult" ? removing.keyResult.title : (removing?.objective.title ?? "")}?`}
        confirmLabel="Delete"
        icon="trash"
        pending={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      >
        It is kept in the Audit Log.
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}
