"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LpjDesk, LpjStatus } from "@website/domain/programs";
import {
  approveLpjAction,
  extendLpjAction,
  returnLpjAction,
  reviewSecretariatAction,
  reviewTreasurerAction,
  saveLpjAction,
  submitLpjAction,
} from "@/app/(panel)/lpj/actions";
import { actionMessage } from "@/components/action-message";
import {
  budgetText,
  Field,
  FormModal,
  num,
  parseBudgets,
  PeriodSwitch,
  text,
  type ActionResult,
} from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, LPJ_DESK_LABELS, LPJ_STATUS_LABELS } from "@/labels";

interface Row {
  id: string;
  name: string;
  unitName: string;
  status: LpjStatus;
  dueOn: string;
  overdue: boolean;
  /** Desks signed (of 3). */
  desks: number;
}

/** LPJ desks: the period's LPJs, overdue first in red. */
export function LpjListPage({
  period,
  periods,
  rows,
}: {
  period: { id: string; name: string } | null;
  periods: Array<{ id: string; name: string }>;
  rows: Row[];
}) {
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "LPJ",
      width: "45%",
      render: (r) => (
        <div>
          <a className="admin-table__title" href={`/lpj/${r.id}`}>
            {r.name}
          </a>
          <div className="admin-table__sub">{r.unitName}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge>{label(LPJ_STATUS_LABELS, r.status)}</Badge>,
    },
    {
      key: "due",
      header: "Due",
      render: (r) =>
        r.overdue ? <Badge tone="danger">Overdue · {r.dueOn}</Badge> : <span>{r.dueOn}</span>,
    },
    { key: "desks", header: "Desks", render: (r) => <span>{r.desks} / 3</span> },
  ];
  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">LPJ</h1>
          <p className="admin-page-header__desc">
            Accountability reports{period ? ` of period ${period.name}` : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {period ? <PeriodSwitch path="/lpj" current={period.id} periods={periods} /> : null}
        </div>
      </div>
      <Card className="admin-events-card admin-list-card">
        <CardBody flush>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="No LPJ yet." />
        </CardBody>
      </Card>
    </div>
  );
}

interface ReportProps {
  lpj: {
    id: string;
    version: number;
    status: LpjStatus;
    dueOn: string;
    overdue: boolean;
    revisionRound: number;
    returnNote: string | null;
    plan: {
      name: string;
      unitName: string;
      goal: string;
      planned: string;
      budgets: string[];
      pics: string[];
      progressPercent: number;
      milestones: Array<{ title: string; done: boolean }>;
    };
    input: {
      realization: string;
      obstacles: string;
      recommendations: string;
      participantCount: number | null;
      realized: Array<{ amountMinor: number; currency: string }> | null;
    };
    realizedText: string | null;
    desks: Array<{ desk: LpjDesk; signedBy: string | null; at: string | null; canSign: boolean }>;
  };
  can: { write: boolean; return: boolean; extend: boolean };
}

const SIGN: Record<LpjDesk, (input: unknown) => Promise<ActionResult>> = {
  secretariat: reviewSecretariatAction,
  treasurer: reviewTreasurerAction,
  approval: approveLpjAction,
};

/** One LPJ: the frozen plan beside the PICs' report, and the three desks. */
export function LpjReportPage({ lpj, can }: ReportProps) {
  const router = useRouter();
  const toast = useToastMessage();
  const [dialog, setDialog] = useState<"edit" | "return" | "extend" | null>(null);
  const ref = { id: lpj.id, version: lpj.version };
  const run = async (action: Promise<ActionResult>, message: string) => {
    const result = await action;
    if (!result.ok) return toast.show(actionMessage(result));
    toast.show(message);
    router.refresh();
  };
  const { plan, input } = lpj;
  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">LPJ · {plan.name}</h1>
          <p className="admin-page-header__desc">
            {plan.unitName} · <Badge>{label(LPJ_STATUS_LABELS, lpj.status)}</Badge> · due{" "}
            {lpj.dueOn}
            {lpj.overdue ? " · overdue" : ""}
            {lpj.revisionRound ? ` · revision round ${lpj.revisionRound}` : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {can.write ? (
            <>
              <Button variant="outline" size="sm" icon="edit" onClick={() => setDialog("edit")}>
                Write LPJ
              </Button>
              <Button
                size="sm"
                icon="send"
                onClick={() => void run(submitLpjAction(ref), "Submitted")}
              >
                Submit
              </Button>
            </>
          ) : null}
          {can.return ? (
            <Button variant="outline" size="sm" icon="undo" onClick={() => setDialog("return")}>
              Return
            </Button>
          ) : null}
          {can.extend ? (
            <Button variant="outline" size="sm" icon="calendar" onClick={() => setDialog("extend")}>
              Extend due date
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            icon="download"
            href={`/api/lpj/${lpj.id}/pdf`}
            target="_blank"
          >
            PDF
          </Button>
        </div>
      </div>
      {lpj.returnNote ? (
        <Card>
          <CardBody>Returned: {lpj.returnNote}</CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Plan (frozen when the programme finished)" />
        <CardBody>
          <p>Goal: {plan.goal || "—"}</p>
          <p>Planned: {plan.planned || "—"}</p>
          <p>Budget: {plan.budgets.join(" · ") || "—"}</p>
          <p>PICs: {plan.pics.join(", ") || "—"}</p>
          <p>Progress: {plan.progressPercent}%</p>
          <ul>
            {plan.milestones.map((m) => (
              <li key={m.title}>
                {m.done ? "✓" : "✗"} {m.title}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Report" />
        <CardBody>
          <p style={{ whiteSpace: "pre-line" }}>Realization: {input.realization || "—"}</p>
          <p>Participants: {input.participantCount ?? "—"}</p>
          <p>Money spent: {lpj.realizedText ?? "not filled in"}</p>
          <p style={{ whiteSpace: "pre-line" }}>Obstacles: {input.obstacles || "—"}</p>
          <p style={{ whiteSpace: "pre-line" }}>Recommendations: {input.recommendations || "—"}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Desks" subtitle="Three different people; the submitter never reviews." />
        <CardBody>
          <ul>
            {lpj.desks.map((d) => (
              <li key={d.desk}>
                {label(LPJ_DESK_LABELS, d.desk)}:{" "}
                {d.signedBy ? `${d.signedBy}, ${d.at}` : "not yet reviewed"}{" "}
                {d.canSign ? (
                  <Button
                    size="sm"
                    icon="check"
                    onClick={() => void run(SIGN[d.desk](ref), "Signed")}
                  >
                    Sign
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <FormModal
        open={dialog === "edit"}
        title="Write LPJ"
        onClose={() => setDialog(null)}
        onSubmit={(form) => {
          const spent = text(form, "realized");
          const count = text(form, "participantCount");
          return saveLpjAction({
            ...ref,
            realization: text(form, "realization"),
            obstacles: text(form, "obstacles"),
            recommendations: text(form, "recommendations"),
            participantCount: count === "" ? null : num(form, "participantCount"),
            realized: spent === "" ? null : parseBudgets(spent),
          });
        }}
      >
        <Field
          label="Realization"
          name="realization"
          rows={5}
          maxLength={8000}
          defaultValue={input.realization}
        />
        <Field
          label="Participants"
          name="participantCount"
          type="number"
          min={0}
          defaultValue={input.participantCount ?? ""}
        />
        <Field
          label="Money spent"
          name="realized"
          rows={3}
          hint="One line per currency, e.g. JPY 42000; write IDR 0 if nothing was spent"
          defaultValue={input.realized ? budgetText(input.realized) : ""}
        />
        <Field
          label="Obstacles"
          name="obstacles"
          rows={3}
          maxLength={4000}
          defaultValue={input.obstacles}
        />
        <Field
          label="Recommendations"
          name="recommendations"
          rows={3}
          maxLength={4000}
          defaultValue={input.recommendations}
        />
      </FormModal>
      <FormModal
        open={dialog === "return"}
        title="Return to the PICs"
        submitLabel="Return"
        onClose={() => setDialog(null)}
        onSubmit={(form) => returnLpjAction({ ...ref, note: text(form, "note") })}
      >
        <Field label="What must be fixed" name="note" rows={3} required maxLength={1000} />
      </FormModal>
      <FormModal
        open={dialog === "extend"}
        title="Extend the due date"
        onClose={() => setDialog(null)}
        onSubmit={(form) => extendLpjAction({ ...ref, dueOn: text(form, "dueOn") })}
      >
        <Field label="New due date" name="dueOn" type="date" required defaultValue={lpj.dueOn} />
      </FormModal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
