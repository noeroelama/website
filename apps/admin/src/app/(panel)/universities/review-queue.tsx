"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { reviewUniversityAction } from "./actions";

export interface ProposalRow {
  id: string;
  version: number;
  name: string;
  countryCode: string;
  city: string | null;
  submittedBy: string | null;
  proposedAt: string;
  /** Approved campuses of the same country that share a distinctive word (merge targets). */
  candidates: { id: string; name: string }[];
}

type Decision =
  { type: "approve" } | { type: "merge"; into: string } | { type: "reject"; note: string };

/** The review queue: one row per proposal with Approve, Merge into … and Reject. */
export function ReviewQueue({ rows, canEdit }: { rows: ProposalRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = async (row: ProposalRow, decision: Decision, done: string) => {
    setBusy(true);
    const result = await reviewUniversityAction({ id: row.id, version: row.version, decision });
    setBusy(false);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(done);
  };

  return (
    <Card>
      <CardBody flush>
        <DataTable
          rowKey={(row) => row.id}
          rows={rows}
          emptyText="No campus proposals waiting for review"
          columns={[
            {
              key: "name",
              header: "Proposed campus",
              render: (row) => (
                <>
                  <span className="admin-table__title">{row.name}</span>
                  <span className="admin-table__sub">
                    {row.countryCode}
                    {row.city ? ` · ${row.city}` : ""} · {row.proposedAt} · by {row.submittedBy}
                  </span>
                </>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (row) =>
                canEdit ? (
                  <div className="admin-table__actions">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={busy}
                      onClick={() => void decide(row, { type: "approve" }, "Campus approved")}
                    >
                      Approve
                    </Button>
                    <select
                      className="admin-select"
                      aria-label={`Merge ${row.name} into`}
                      value={targets[row.id] ?? ""}
                      onChange={(e) => setTargets((t) => ({ ...t, [row.id]: e.target.value }))}
                    >
                      <option value="">
                        {row.candidates.length > 0 ? "Merge into…" : "No similar listed campus"}
                      </option>
                      {row.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !targets[row.id]}
                      onClick={() =>
                        void decide(
                          row,
                          { type: "merge", into: targets[row.id] ?? "" },
                          "Merged; members now point at the listed campus",
                        )
                      }
                    >
                      Merge
                    </Button>
                    <input
                      className="admin-input"
                      aria-label={`Reason to reject ${row.name}`}
                      placeholder="Reason to reject"
                      value={notes[row.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy || !notes[row.id]?.trim()}
                      onClick={() =>
                        void decide(
                          row,
                          { type: "reject", note: notes[row.id] ?? "" },
                          "Rejected; members choose their campus again",
                        )
                      }
                    >
                      Reject
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      </CardBody>
      <ToastBanner message={toast.message} />
    </Card>
  );
}
