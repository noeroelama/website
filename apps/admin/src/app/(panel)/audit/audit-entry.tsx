"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionError } from "@/components/action-error";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { revertAction } from "./actions";

export interface Change {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

/** Changed fields only (Field, Before, After). */
export function ChangeTable({ changes }: { changes: readonly Change[] }) {
  return (
    <DataTable
      rows={[...changes]}
      rowKey={(row) => row.field}
      emptyText="No field changes recorded"
      columns={[
        { key: "field", header: "Field" },
        { key: "before", header: "Before" },
        { key: "after", header: "After" },
      ]}
    />
  );
}

/** Disabled with the reason as tooltip, or a confirm dialog showing the same table. */
export function RevertButton(props: {
  id: string;
  changes: readonly Change[];
  disabledReason: string | null;
  reauthUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabledReason !== null || pending}
        title={props.disabledReason ?? "Restore the Before values of these fields"}
        onClick={() => setOpen(true)}
      >
        Revert
      </Button>
      <ActionError text={error} reauthUrl={props.reauthUrl} />
      <ConfirmDialog
        open={open}
        title="Revert this change?"
        confirmLabel="Revert"
        tone="primary"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            setOpen(false);
            const result = await revertAction({ id: props.id });
            if (!result.ok) return setError(actionMessage(result));
            router.refresh();
          })
        }
      >
        <p>Only these fields get their Before value back. A new REVERT entry is added.</p>
        <ChangeTable changes={props.changes} />
      </ConfirmDialog>
    </div>
  );
}
