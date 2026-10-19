"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { setGraduationAction } from "./actions";

/**
 * Graduation (B5): the member marks or corrects the date at once; "cancel" only for a mark they
 * set themselves (the server checks; an officer's mark is cancelled by the secretariat).
 */
export function GraduationForm(props: {
  t: Dictionary["profile"];
  version: number;
  graduatedOn: string | null;
}) {
  const { t } = props;
  const router = useRouter();
  const [date, setDate] = useState(props.graduatedOn ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async (graduatedOn: string | null) => {
    setBusy(true);
    const result = await setGraduationAction({ version: props.version, graduatedOn });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message === "conflict" ? t.conflict : result.message);
      return;
    }
    setMessage(null);
    router.refresh();
  };

  return (
    <div className="ui-form">
      <label className="ui-field">
        {t.graduationDate}
        <input
          className="ui-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button
        className="ui-button"
        type="button"
        disabled={busy || !date}
        onClick={() => void send(date)}
      >
        {t.graduationMark}
      </button>
      {props.graduatedOn && (
        <button className="ui-button" type="button" disabled={busy} onClick={() => void send(null)}>
          {t.graduationCancel}
        </button>
      )}
      {message && (
        <p role="alert" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
