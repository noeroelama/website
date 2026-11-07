"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addParticipantsAction, removeParticipantAction } from "@/app/(panel)/letters/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { ListCard, ListEmpty, useListTable } from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

/* ==================================================================
   Certificate batch (D5) — participants pasted from a spreadsheet
   (one per line; a note and an e-mail after TAB ; or |, never a
   comma; the e-mail is stored only as a keyed hash). Each gets
   a sheet number and its own verification code; the sheets are
   rendered on demand. Removing one never renumbers the others.
   ================================================================== */

interface Sheet {
  id: string;
  seq: number;
  name: string;
  note: string | null;
  /** Once the batch is issued. */
  number: string | null;
  code: string | null;
  /** An e-mail was pasted: the holder can download the sheet on the website (/certificates). */
  hasEmail: boolean;
}

interface Props {
  batch: { id: string; subject: string; number: string | null; statusLabel: string };
  sheets: Sheet[];
  /** letters.edit in the batch's unit, and the batch is still a draft or under review. */
  canEdit: boolean;
  /** Bulk sending (issued batches): the panel, or null. */
  send: ReactNode;
}

export function ParticipantsPage({ batch, sheets, canEdit, send }: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [text, setText] = useState("");
  const [titleCase, setTitleCase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Sheet | null>(null);
  const table = useListTable(sheets, (s: Sheet, _key: "seq") => s.seq);

  const add = async () => {
    setBusy(true);
    const result = await addParticipantsAction({ batchId: batch.id, text, titleCase });
    setBusy(false);
    if (!result.ok) return toast.show(actionMessage(result));
    toast.show(`${result.data.added} participants added`);
    setText("");
    router.refresh();
  };

  const remove = async (sheet: Sheet) => {
    setBusy(true);
    const result = await removeParticipantAction({ batchId: batch.id, id: sheet.id });
    setBusy(false);
    setRemoving(null);
    if (!result.ok) return toast.show(actionMessage(result));
    toast.show("Participant removed");
    router.refresh();
  };

  const columns: Column<Sheet>[] = [
    {
      key: "seq",
      header: "No.",
      width: "8%",
      render: (s) => <span className="admin-table__sub">{String(s.seq).padStart(3, "0")}</span>,
    },
    {
      key: "name",
      header: "Name",
      width: "44%",
      render: (s) => (
        <div>
          <div className="admin-table__title">{s.name}</div>
          {s.note ? <div className="admin-table__sub">{s.note}</div> : null}
          <div className="admin-table__sub">
            {s.hasEmail ? "Pickup by e-mail" : "No e-mail (no self pickup)"}
          </div>
        </div>
      ),
    },
    {
      key: "number",
      header: "Number / code",
      width: "36%",
      render: (s) => (
        <span className="admin-table__sub">
          {s.number ? `${s.number} · ${s.code ?? ""}` : "Given when the batch is issued"}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "12%",
      render: (s) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="eye"
            aria-label={`Sheet of ${s.name}`}
            onClick={() =>
              window.open(`/api/letters/${batch.id}/certificates/${s.id}`, "_blank", "noopener")
            }
          />
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              aria-label={`Remove ${s.name}`}
              onClick={() => setRemoving(s)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Letters &gt; {batch.subject}</h1>
          <p className="admin-page-header__desc">
            Certificate batch · {batch.number ?? batch.statusLabel} · {sheets.length} participants
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/letters")}
          >
            Letters
          </Button>
        </div>
      </div>
      {send}
      {canEdit ? (
        <form
          className="admin-dark-form"
          onSubmit={(event) => event.preventDefault() /* actions run from the submit buttons */}
        >
          <label className="admin-field">
            <span className="admin-field__label">
              Paste participants: one per line; a note (Narasumber, Juara 1) and the e-mail used at
              registration (for pickup on the website) after a TAB, ; or |
            </span>
            <textarea
              className="admin-input admin-textarea"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>
              <input
                type="checkbox"
                checked={titleCase}
                onChange={(e) => setTitleCase(e.target.checked)}
              />{" "}
              Title case the names (ARIF NURWAHID → Arif Nurwahid; degrees stay as typed)
            </span>
          </label>
          <div className="admin-form-actions">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              icon="plus"
              disabled={busy || !text.trim()}
              onClick={() => add()}
            >
              Add participants
            </Button>
          </div>
        </form>
      ) : null}
      <ListCard
        table={table}
        noun="participant"
        columns={columns}
        empty={
          <ListEmpty
            noun="participant"
            query=""
            filters={0}
            emptyHint="No participants yet: paste the list above."
            onClear={() => undefined}
          />
        }
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this participant?"
        pending={busy}
        onConfirm={() => void (removing && remove(removing))}
        onCancel={() => setRemoving(null)}
      >
        {removing?.name} loses the sheet and its verification code. The others keep their numbers.
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}
