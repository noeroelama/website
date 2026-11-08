"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryCertificateSendsAction, sendCertificatesAction } from "@/app/(panel)/letters/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";

const STATUS_LABELS: Record<string, string> = {
  not_sent: "not sent",
  sent: "sent",
  logged: "recorded only (test mode)",
  blocked: "blocked (test environment)",
  skipped: "no address",
  failed: "failed",
  queued: "sending",
};

export function CertificateSendPanel({
  batchId,
  progress,
}: {
  batchId: string;
  progress: Record<string, number>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    const result = await sendCertificatesAction({ batchId, text });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    const d = result.data;
    setMessage(
      `${d.sent} sent${d.remaining ? `, ${d.remaining} left (click again)` : ""}` +
        `${d.unmatched ? `, ${d.unmatched} lines match no sheet` : ""}` +
        `${d.withoutEmail ? `, ${d.withoutEmail} sheets have no e-mail` : ""}.`,
    );
    router.refresh();
  };
  const retry = async () => {
    setBusy(true);
    const result = await retryCertificateSendsAction({ batchId });
    setBusy(false);
    setMessage(result.ok ? `${result.data.retried} sent again.` : actionMessage(result));
    router.refresh();
  };

  return (
    <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
      <p className="admin-field__label">
        Send pickup links:{" "}
        {Object.entries(progress)
          .map(([status, count]) => `${count} ${STATUS_LABELS[status] ?? status}`)
          .join(" · ")}
      </p>
      <textarea
        className="admin-input admin-textarea"
        rows={4}
        aria-label="Participant list with e-mails"
        placeholder="Paste the same list with e-mails (they are not stored, only matched)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="admin-modal__footer-row">
        <Button
          type="submit"
          size="sm"
          icon="send"
          disabled={busy || !text.trim()}
          onClick={() => send()}
        >
          Send links
        </Button>
        {progress["failed"] ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => retry()}>
            Retry failed
          </Button>
        ) : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
