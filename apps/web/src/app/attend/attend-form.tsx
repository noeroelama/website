"use client";

import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { attendAction } from "./actions";

export function AttendForm({ code, labels: t }: { code: string; labels: Dictionary["attend"] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await attendAction(new FormData(event.currentTarget).get("code"));
      if (result.ok) setMessage(`${t.done} "${result.title}".`);
      else
        setMessage(
          {
            signin: t.signin,
            invalid: t.invalid,
            not_participant: t.notParticipant,
            closed: t.closed,
          }[result.error],
        );
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="site-filters" onSubmit={(e) => void submit(e)}>
      <label htmlFor="attend-code">{t.code}</label>
      <input
        id="attend-code"
        name="code"
        className="ui-input"
        defaultValue={code}
        autoComplete="off"
        autoCapitalize="characters"
        maxLength={12}
        required
      />
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
      {message && (
        <p role="status" className="ui-message" data-tone="info">
          {message}
        </p>
      )}
    </form>
  );
}
