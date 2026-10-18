"use client";

import { useState } from "react";
import { confirmAction, unsubscribeAction } from "./actions";

/**
 * Confirm / unsubscribe run from a button (POST), not from the plain GET of the e-mail link, so
 * mail scanners that open links do not confirm or unsubscribe on someone's behalf.
 */
function ActionButton(props: { label: string; run: () => Promise<string> }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (result) return <p role="status">{result}</p>;
  return (
    <button
      className="ui-button"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void props.run().then(setResult);
      }}
    >
      {props.label}
    </button>
  );
}

export function ConfirmButton(props: {
  s: string;
  t: string;
  labels: { button: string; confirmed: string; expired: string; invalid: string };
}) {
  const { labels } = props;
  return (
    <ActionButton
      label={labels.button}
      run={async () => {
        const outcome = await confirmAction({ s: props.s, t: props.t });
        return outcome === "confirmed"
          ? labels.confirmed
          : outcome === "expired"
            ? labels.expired
            : labels.invalid;
      }}
    />
  );
}

export function UnsubscribeButton(props: {
  token: string;
  labels: { button: string; done: string; invalid: string };
}) {
  const { labels } = props;
  return (
    <ActionButton
      label={labels.button}
      run={async () => ((await unsubscribeAction(props.token)) ? labels.done : labels.invalid)}
    />
  );
}
