"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { decideChangeAction, verifyProfileAction } from "./actions";

export interface VerifyRow {
  uid: string;
  version: number;
  name: string;
  detail: string;
  born: string;
}

export interface ChangeRow {
  uid: string;
  version: number;
  name: string;
  since: string;
  changes: string[];
}

/** The two queues of the Members page; every decision is re-checked on the server. */
export function MemberQueues({
  toVerify,
  changes,
}: {
  toVerify: VerifyRow[];
  changes: ChangeRow[];
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const run = async (action: () => Promise<{ ok: true } | ActionFailure>, done: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(done);
  };

  return (
    <>
      <Card>
        <CardHeader title="To verify" />
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.uid}
            rows={toVerify}
            emptyText="No profiles waiting for verification"
            columns={[
              {
                key: "name",
                header: "Member",
                render: (r) => (
                  <>
                    <span className="admin-table__title">{r.name}</span>
                    <span className="admin-table__sub">
                      {r.detail} · born {r.born}
                    </span>
                  </>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) => (
                  <Button
                    size="sm"
                    variant="success"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => verifyProfileAction({ uid: r.uid, version: r.version }),
                        `${r.name} verified`,
                      )
                    }
                  >
                    Verify
                  </Button>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Changes of verified data" />
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.uid}
            rows={changes}
            emptyText="No changes waiting for review"
            columns={[
              {
                key: "name",
                header: "Member",
                render: (r) => (
                  <>
                    <span className="admin-table__title">{r.name}</span>
                    <span className="admin-table__sub">since {r.since}</span>
                    <ul>
                      {r.changes.map((c) => (
                        <li key={c} className="admin-table__sub">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) => (
                  <div className="admin-table__actions">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            decideChangeAction({
                              uid: r.uid,
                              version: r.version,
                              approve: true,
                              note: notes[r.uid] ?? "",
                            }),
                          "Change approved",
                        )
                      }
                    >
                      Approve
                    </Button>
                    <input
                      className="admin-input"
                      aria-label={`Note for ${r.name}`}
                      placeholder="Note (why rejected)"
                      value={notes[r.uid] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.uid]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy || !notes[r.uid]?.trim()}
                      onClick={() =>
                        void run(
                          () =>
                            decideChangeAction({
                              uid: r.uid,
                              version: r.version,
                              approve: false,
                              note: notes[r.uid] ?? "",
                            }),
                          "Change rejected",
                        )
                      }
                    >
                      Reject
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>
      <ToastBanner message={toast.message} />
    </>
  );
}
