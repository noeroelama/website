"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import { respondOfferAction } from "./actions";

/** Accept (takes the seat; refused when the unit is full) or decline the own offer. */
export function OfferButtons(props: { recruitmentId: string; labels: Dictionary["recruitment"] }) {
  const router = useRouter();
  const t = props.labels;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const respond = async (accept: boolean) => {
    if (!accept && !window.confirm(`${t.decline}?`)) return;
    setBusy(true);
    const result = await respondOfferAction({ recruitmentId: props.recruitmentId, accept });
    setBusy(false);
    setMessage(
      result.ok
        ? accept
          ? t.acceptedMsg
          : t.declinedMsg
        : result.error === "refused"
          ? (result.message ?? t.failed)
          : t.failed,
    );
    if (result.ok) router.refresh();
  };
  return (
    <div className="site-filters">
      <button
        className="ui-button"
        type="button"
        disabled={busy}
        onClick={() => void respond(true)}
      >
        {t.accept}
      </button>
      <button
        className="ui-button"
        type="button"
        disabled={busy}
        onClick={() => void respond(false)}
      >
        {t.decline}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
