"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { exportFormResponsesAction } from "@/app/(panel)/forms/actions";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { esc } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

interface ResponseRow {
  id: string;
  cells: string[];
}

export function FormResponsesPage(props: {
  id: string;
  title: string;
  total: number;
  header: string[];
  rows: ResponseRow[];
  canExport: boolean;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);

  const columns: Column<ResponseRow>[] = props.header.map((text, i) => ({
    key: String(i),
    header: text,
    render: (row) => <span className="admin-table__title">{row.cells[i]}</span>,
  }));

  const exportCsv = async () => {
    setBusy(true);
    const result = await exportFormResponsesAction({ id: props.id });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const slug = result.data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadCsv(`responses-${slug || "form"}`, [
      result.data.header.map(esc),
      ...result.data.rows.map((row) => row.map(esc)),
    ]);
    toast.show(`${result.data.rows.length} responses exported`);
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Forms &gt; Responses</h1>
          <p className="admin-page-header__desc">
            {props.title} — {props.total} {props.total === 1 ? "response" : "responses"}
            {props.rows.length < props.total ? ` (newest ${props.rows.length} shown)` : ""}. Answers
            are personal data: export only what you need.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/forms")}
          >
            Back
          </Button>
          <div className="admin-fab">
            {props.canExport ? (
              <Button
                variant="outline"
                size="sm"
                icon="download"
                disabled={busy || props.total === 0}
                onClick={() => exportCsv()}
              >
                Export CSV
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={props.rows}
            rowKey={(row) => row.id}
            emptyText="No responses yet"
          />
        </CardBody>
      </Card>
      <ToastBanner message={toast.message} />
    </div>
  );
}
