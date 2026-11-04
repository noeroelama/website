"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { draftMinutesAction, saveActionItemAction } from "@/app/(panel)/meetings/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type Proposal = { title: string; pic: string | null; dueOn: string | null };

/**
 * F6: paste a transcript or open a Zoom .vtt file → the machine fills the EMPTY agenda items;
 * proposed follow-ups are listed for a person to add (the server re-checks each PIC).
 */
export function DraftMinutes({
  meetingId,
  version,
  names,
}: {
  meetingId: string;
  version: number;
  names: ReadonlyMap<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await draftMinutesAction({
      id: meetingId,
      version,
      transcript,
      source: "ai_transcript",
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setProposals(result.data.proposals);
    setMessage("Draft added to the empty agenda items. Check and edit it before approving.");
    router.refresh();
  };
  const add = async (p: Proposal, index: number) => {
    if (!p.pic) return;
    const result = await saveActionItemAction({
      version: null,
      meetingId,
      title: p.title,
      pic: p.pic,
      dueOn: p.dueOn,
    });
    if (!result.ok) return setMessage(actionMessage(result));
    setProposals((all) => all.filter((_, i) => i !== index));
    router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="outline" icon="note" onClick={() => setOpen(true)}>
        Draft from transcript
      </Button>
      <Modal open={open} title="Draft minutes from a transcript" onClose={() => setOpen(false)}>
        <form onSubmit={(e) => void submit(e)}>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="vtt-file">
              Zoom transcript (.vtt) or paste below
            </label>
            <input
              id="vtt-file"
              type="file"
              accept=".vtt,.txt,text/vtt,text/plain"
              onChange={(e) => void e.target.files?.[0]?.text().then(setTranscript)}
            />
          </div>
          <textarea
            className="admin-textarea"
            rows={10}
            aria-label="Transcript"
            value={transcript}
            maxLength={200_000}
            onChange={(e) => setTranscript(e.target.value)}
          />
          {message ? <p role="status">{message}</p> : null}
          {proposals.length > 0 ? (
            <ul>
              {proposals.map((p, i) => (
                <li key={`${p.title}-${i}`}>
                  {p.title} — {p.pic ? (names.get(p.pic) ?? p.pic) : "no PIC (add it by hand)"}
                  {p.dueOn ? `, due ${p.dueOn}` : ""}{" "}
                  {p.pic ? (
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => void add(p, i)}>
                      Add
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button type="submit" disabled={busy || transcript.trim().length < 20}>
              {busy ? "Drafting…" : "Draft"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
