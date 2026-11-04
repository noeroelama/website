"use client";

import { useState } from "react";
import type { PeriodStatus } from "@website/domain/organizations";
import type { HealthStatus, ProgramStatus } from "@website/domain/programs";
import { saveProgramAction } from "@/app/(panel)/programs/actions";
import {
  budgetText,
  ChoiceField,
  Field,
  FormModal,
  parseBudgets,
  PeriodSwitch,
  text,
} from "@/components/program-ui";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { HEALTH_STATUS_LABELS, label, PROGRAM_STATUS_LABELS } from "@/labels";

export const HEALTH_TONE: Record<HealthStatus, BadgeTone> = {
  on_track: "success",
  at_risk: "warn",
  off_track: "danger",
};

interface Row {
  id: string;
  name: string;
  unitName: string;
  status: ProgramStatus;
  progress: number;
  health: HealthStatus | null;
  /** The viewer is a PIC of it. */
  mine: boolean;
}

/** What the plan form offers: the units the viewer may plan for, the period's key results. */
export interface PlanOptions {
  units: Array<{ id: string; name: string }>;
  /** `objectiveId:keyResultId` → "Objective → Key result". */
  keyResults: Array<{ value: string; label: string }>;
}

/** The current plan, when editing. */
export interface PlanValues {
  id: string;
  version: number;
  name: string;
  goal: string;
  description: string;
  orgUnitId: string;
  objectiveId: string | null;
  keyResultId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  budgets: Array<{ amountMinor: number; currency: string }>;
  picEmails: string[];
}

/** Add / edit a programme plan (one form for both). */
export function PlanForm({
  open,
  onClose,
  periodId,
  options,
  current,
}: {
  open: boolean;
  onClose: () => void;
  periodId: string;
  options: PlanOptions;
  current: PlanValues | null;
}) {
  return (
    <FormModal
      open={open}
      title={current ? "Edit programme" : "Add New Programme"}
      onClose={onClose}
      onSubmit={(form) => {
        const [objectiveId = "", keyResultId = ""] = text(form, "keyResult").split(":");
        return saveProgramAction({
          ...(current ? { id: current.id } : {}),
          version: current?.version ?? null,
          periodId,
          plan: {
            name: text(form, "name"),
            goal: text(form, "goal"),
            description: text(form, "description"),
            orgUnitId: text(form, "orgUnitId"),
            objectiveId: objectiveId || null,
            keyResultId: keyResultId || null,
            plannedStart: text(form, "plannedStart") || null,
            plannedEnd: text(form, "plannedEnd") || null,
            budgets: parseBudgets(text(form, "budgets")),
          },
          picEmails: text(form, "pics")
            .split(/[\s,]+/)
            .filter(Boolean),
        });
      }}
    >
      <Field
        label="Name"
        name="name"
        required
        minLength={3}
        maxLength={200}
        defaultValue={current?.name ?? ""}
      />
      <ChoiceField
        label="Unit"
        name="orgUnitId"
        defaultValue={current?.orgUnitId ?? options.units[0]?.id ?? ""}
        options={options.units.map((u) => ({ value: u.id, label: u.name }))}
      />
      <ChoiceField
        label="Key result"
        name="keyResult"
        defaultValue={current?.objectiveId ? `${current.objectiveId}:${current.keyResultId}` : ""}
        options={[{ value: "", label: "None yet" }, ...options.keyResults]}
      />
      <Field
        label="Goal"
        name="goal"
        rows={2}
        maxLength={2000}
        defaultValue={current?.goal ?? ""}
      />
      <Field
        label="Background"
        name="description"
        rows={3}
        maxLength={4000}
        defaultValue={current?.description ?? ""}
      />
      <Field
        label="Planned start"
        name="plannedStart"
        type="date"
        defaultValue={current?.plannedStart ?? ""}
      />
      <Field
        label="Planned end"
        name="plannedEnd"
        type="date"
        defaultValue={current?.plannedEnd ?? ""}
      />
      <Field
        label="Budget"
        name="budgets"
        rows={3}
        hint="One line per currency, e.g. JPY 50000 (never converted)"
        defaultValue={budgetText(current?.budgets ?? [])}
      />
      <Field
        label="PICs (account e-mails)"
        name="pics"
        rows={2}
        hint="Needed before approval; PICs run the programme"
        defaultValue={(current?.picEmails ?? []).join("\n")}
      />
    </FormModal>
  );
}

/** Programmes (E2): the period's programmes with status, progress and health. */
export function ProgramsPage({
  period,
  periods,
  rows,
  plan,
}: {
  period: { id: string; name: string; status: PeriodStatus } | null;
  periods: Array<{ id: string; name: string }>;
  rows: Row[];
  /** null = the viewer cannot propose here. */
  plan: PlanOptions | null;
}) {
  const [adding, setAdding] = useState(false);
  if (!period) {
    return (
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">Programmes</h1>
        <p className="admin-page-header__desc">Create a board period first (Organizations).</p>
      </div>
    );
  }
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Programme",
      width: "40%",
      render: (r) => (
        <div>
          <a className="admin-table__title" href={`/programs/${r.id}`}>
            {r.name}
          </a>
          <div className="admin-table__sub">
            {r.unitName}
            {r.mine ? " · You are PIC" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge>{label(PROGRAM_STATUS_LABELS, r.status)}</Badge>,
    },
    {
      key: "progress",
      header: "Progress",
      render: (r) => <span className="admin-table__title">{r.progress}%</span>,
    },
    {
      key: "health",
      header: "Health",
      render: (r) =>
        r.health ? (
          <Badge tone={HEALTH_TONE[r.health]}>{label(HEALTH_STATUS_LABELS, r.health)}</Badge>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Programmes</h1>
          <p className="admin-page-header__desc">
            Work programmes of period {period.name}
            {period.status === "archived" ? " · Archived period" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <PeriodSwitch path="/programs" current={period.id} periods={periods} />
          <div className="admin-fab">
            {plan ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setAdding(true)}>
                Add New Programme
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Card className="admin-events-card admin-list-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="No programmes in this period yet."
          />
        </CardBody>
      </Card>
      {plan ? (
        <PlanForm
          open={adding}
          onClose={() => setAdding(false)}
          periodId={period.id}
          options={plan}
          current={null}
        />
      ) : null}
    </div>
  );
}
