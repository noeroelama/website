"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MinutesSource } from "@website/domain/meetings";
import {
  approveMinutesAction,
  removeActionItemAction,
  saveActionItemAction,
  saveMinutesAction,
  setActionItemDoneAction,
} from "@/app/(panel)/meetings/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { ChoiceField, Field, FormModal, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export interface MinutesView {
  notes: Record<string, string>;
  other: string;
  quorum: number | null;
  source: MinutesSource;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface ActionItemView {
  id: string;
  version: number;
  title: string;
  pic: string;
  picName: string;
  dueOn: string | null;
  done: boolean;
  mine: boolean;
}

const SOURCE_LABELS: Record<MinutesSource, string> = {
  manual: "Written by hand",
  ai_transcript: "Drafted from a transcript, then edited",
  ai_zoom: "Drafted from the Zoom transcript, then edited",
};

export function MinutesPanel({
  meetingId,
  version,
  agenda,
  minutes,
  items,
  participants,
  runs,
  canApprove,
  extra,
}: {
  meetingId: string;
  version: number;
  agenda: Array<{ id: string; title: string }>;
  minutes: MinutesView | null;
  items: ActionItemView[];
  participants: Array<{ uid: string; name: string }>;
  runs: boolean;
  canApprove: boolean;
  extra?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [writing, setWriting] = useState(false);
  const [item, setItem] = useState<ActionItemView | "new" | null>(null);
  const locked = (minutes?.approvedAt ?? null) !== null;

  const run = async (action: Promise<{ ok: true } | ActionFailure>) => {
    const result = await action;
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
  };

  return (
    <>
      <ToastBanner message={toast.message} />
      <Card>
        <CardHeader
          title="Minutes"
          subtitle={
            minutes
              ? `${SOURCE_LABELS[minutes.source]}${locked ? ` · Approved by ${minutes.approvedBy}` : " · Draft"}`
              : "Not written yet"
          }
          actions={
            <>
              {extra}
              {runs && !locked ? (
                <Button size="sm" variant="outline" icon="edit" onClick={() => setWriting(true)}>
                  Write minutes
                </Button>
              ) : null}
              {canApprove && minutes && !locked ? (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => run(approveMinutesAction({ id: meetingId, version }))}
                >
                  Approve and lock
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                icon="download"
                href={`/api/meetings/${meetingId}/minutes`}
              >
                PDF
              </Button>
            </>
          }
        />
        <CardBody>
          {minutes ? (
            <>
              {minutes.quorum !== null ? <p>Quorum: {minutes.quorum}</p> : null}
              {agenda.map((a, i) => (
                <div key={a.id}>
                  <h3 className="admin-table__title">
                    {i + 1}. {a.title}
                  </h3>
                  <p style={{ whiteSpace: "pre-wrap" }}>{minutes.notes[a.id] ?? "—"}</p>
                </div>
              ))}
              {minutes.other ? <p style={{ whiteSpace: "pre-wrap" }}>{minutes.other}</p> : null}
            </>
          ) : (
            <p className="admin-page-header__desc">No minutes yet.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Action items"
          actions={
            runs ? (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setItem("new")}>
                Add
              </Button>
            ) : null
          }
        />
        <CardBody>
          {items.length === 0 ? <p className="admin-page-header__desc">No follow-ups.</p> : null}
          <ul>
            {items.map((a) => (
              <li key={a.id}>
                {a.done ? <Badge tone="success">Done</Badge> : null} {a.title} — {a.picName}
                {a.dueOn ? `, due ${a.dueOn}` : ""}{" "}
                {runs || a.mine ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(
                        setActionItemDoneAction({ id: a.id, version: a.version, done: !a.done }),
                      )
                    }
                  >
                    {a.done ? "Reopen" : "Mark done"}
                  </Button>
                ) : null}
                {runs ? (
                  <>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setItem(a)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      onClick={() =>
                        void run(removeActionItemAction({ id: a.id, version: a.version }))
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <FormModal
        open={writing}
        title="Minutes"
        onClose={() => setWriting(false)}
        onSubmit={(form) => {
          const quorum = text(form, "quorum");
          return saveMinutesAction({
            id: meetingId,
            version,
            notes: Object.fromEntries(agenda.map((a) => [a.id, text(form, `note-${a.id}`)])),
            other: text(form, "other"),
            quorum: quorum === "" ? null : Number(quorum),
          });
        }}
      >
        {agenda.map((a, i) => (
          <Field
            key={a.id}
            label={`${i + 1}. ${a.title}`}
            name={`note-${a.id}`}
            rows={4}
            defaultValue={minutes?.notes[a.id] ?? ""}
          />
        ))}
        <Field label="Other business" name="other" rows={3} defaultValue={minutes?.other ?? ""} />
        <Field
          label="Quorum (people needed)"
          name="quorum"
          type="number"
          min={1}
          hint="Empty = not set"
          defaultValue={minutes?.quorum ?? ""}
        />
      </FormModal>
      {item ? (
        <FormModal
          open
          title={item === "new" ? "Add action item" : "Edit action item"}
          onClose={() => setItem(null)}
          onSubmit={(form) =>
            saveActionItemAction({
              ...(item === "new" ? {} : { id: item.id }),
              version: item === "new" ? null : item.version,
              meetingId,
              title: text(form, "title"),
              pic: text(form, "pic"),
              dueOn: text(form, "dueOn") || null,
            })
          }
        >
          <Field
            label="Follow-up"
            name="title"
            required
            maxLength={500}
            defaultValue={item === "new" ? "" : item.title}
          />
          <ChoiceField
            label="PIC (a participant)"
            name="pic"
            defaultValue={item === "new" ? (participants[0]?.uid ?? "") : item.pic}
            options={participants.map((p) => ({ value: p.uid, label: p.name }))}
          />
          <Field
            label="Due"
            name="dueOn"
            type="date"
            defaultValue={item === "new" ? "" : (item.dueOn ?? "")}
          />
        </FormModal>
      ) : null}
    </>
  );
}
