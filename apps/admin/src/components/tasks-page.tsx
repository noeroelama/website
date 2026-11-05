"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TASK_KIND_LABELS, type TaskKind } from "@website/domain/tasks";
import { shareBoardAction } from "@/app/(panel)/tasks/actions";
import { Field, FormModal, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";

interface Row {
  id: string;
  kind: TaskKind;
  title: string;
  source: string;
  due: string | null;
  done: boolean;
  overdue: boolean;
  /** null = the viewer may not open the source page (a shared board shows the task only). */
  href: string | null;
}

/** My Tasks and unit boards (G1): one list; done in the source module, never here. */
export function TasksPage({
  title,
  description,
  rows,
  boards,
  share,
}: {
  title: string;
  description: string;
  rows: Row[];
  /** Unit boards to open (My Tasks only). */
  boards: Array<{ id: string; name: string }>;
  /** Sharing of this board (tasks.share), or null. */
  share: { orgUnitId: string; with: Array<{ uid: string; email: string }> } | null;
}) {
  const router = useRouter();
  const [sharing, setSharing] = useState<boolean | null>(null);
  const columns: Column<Row>[] = [
    {
      key: "title",
      header: "Task",
      width: "45%",
      render: (r) => (
        <div>
          {r.href ? (
            <a className="admin-table__title" href={r.href}>
              {r.title}
            </a>
          ) : (
            <span className="admin-table__title">{r.title}</span>
          )}
          <div className="admin-table__sub">
            {TASK_KIND_LABELS[r.kind]} · {r.source}
          </div>
        </div>
      ),
    },
    { key: "due", header: "Due", render: (r) => r.due ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.done ? (
          <Badge tone="success">Done</Badge>
        ) : r.overdue ? (
          <Badge tone="danger">Overdue</Badge>
        ) : (
          <Badge>Open</Badge>
        ),
    },
  ];
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">{title}</h1>
          <p className="admin-page-header__desc">{description}</p>
        </div>
        <div className="admin-page-header__actions">
          {boards.length > 0 ? (
            <Select
              aria-label="Open a unit board"
              className="admin-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) router.push(`/tasks/unit/${e.target.value}`);
              }}
            >
              <option value="">Unit boards…</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : null}
          {share ? (
            <Button size="sm" variant="outline" icon="users" onClick={() => setSharing(true)}>
              Share ({share.with.length})
            </Button>
          ) : null}
        </div>
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="Nothing to do."
          />
        </CardBody>
      </Card>
      {share && sharing !== null ? (
        <FormModal
          open
          title="Share this board (view only)"
          submitLabel={sharing ? "Share" : "Stop sharing"}
          onClose={() => setSharing(null)}
          onSubmit={(form) =>
            shareBoardAction({
              orgUnitId: share.orgUnitId,
              email: text(form, "email"),
              shared: sharing,
            })
          }
        >
          <p className="admin-page-header__desc">
            A share shows the tasks only; links open only for people who may open the source page.
            {share.with.length ? ` Shared with: ${share.with.map((w) => w.email).join(", ")}.` : ""}
          </p>
          <Field label="Account e-mail" name="email" type="email" required />
          <Button size="sm" variant="ghost" onClick={() => setSharing(!sharing)}>
            {sharing ? "Stop sharing instead" : "Share instead"}
          </Button>
        </FormModal>
      ) : null}
    </div>
  );
}
