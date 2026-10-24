"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import { withdrawApplicationAction } from "./actions";

/** Withdraw the own application (asks first; the server re-checks the status). */
export function WithdrawButton(props: {
  recruitmentId: string;
  labels: Dictionary["recruitment"];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const t = props.labels;
  const withdraw = async () => {
    if (!window.confirm(`${t.withdraw}?`)) return;
    setBusy(true);
    const result = await withdrawApplicationAction({ recruitmentId: props.recruitmentId });
    setBusy(false);
    setMessage(result.ok ? t.withdrawn : result.error === "locked" ? t.locked : t.failed);
    if (result.ok) router.refresh();
  };
  return (
    <div>
      <button className="ui-button" type="button" disabled={busy} onClick={() => void withdraw()}>
        {t.withdraw}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
