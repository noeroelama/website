"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { openLetterAction } from "./actions";

type Content = "shown" | "changed" | "needs_name" | "none";

/**
 * The content part of /verify/<code>: shown, refused (changed), or the recipient-name gate. The
 * typed name is sent by a server action (never in the URL) and again with the download form.
 */
export function LetterContent(props: {
  code: string;
  content: Content;
  bodyHtml: string | null;
  canDownload: boolean;
  cancelled: boolean;
  hint: string | null;
  labels: Dictionary["verification"];
}) {
  const t = props.labels;
  const [state, setState] = useState({
    content: props.content,
    bodyHtml: props.bodyHtml,
    canDownload: props.canDownload,
    wrongName: false,
    name: "",
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = async (name: string) => {
    setBusy(true);
    const result = await openLetterAction({ code: props.code, name });
    setBusy(false);
    setFailed(!result.ok);
    if (result.ok) setState({ ...result, name });
  };

  return (
    <section>
      <h2>{t.content}</h2>
      {state.content === "changed" && <p className="site-notice">{t.changed}</p>}
      {state.content === "none" && <p>{t.noContent}</p>}
      {state.content === "needs_name" && (
        <form
          className="ui-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = new FormData(event.currentTarget).get("name");
            void open(typeof name === "string" ? name : "");
          }}
        >
          <p>
            {t.needsName} <strong>{props.hint}</strong>
          </p>
          {state.wrongName && <p className="site-notice">{t.wrongName}</p>}
          {failed && <p className="site-notice">{t.failed}</p>}
          <label className="ui-field">
            <span>{t.nameLabel}</span>
            <input className="ui-input" name="name" required maxLength={200} autoComplete="off" />
          </label>
          <button className="ui-button" type="submit" disabled={busy}>
            {t.open}
          </button>
        </form>
      )}
      {state.content === "shown" && state.bodyHtml !== null && (
        <>
          {/* Sanitized on the server (allowlist) when saved and again before it was sent. */}
          <div className="site-letter" dangerouslySetInnerHTML={{ __html: state.bodyHtml }} />
          <p className="site-muted">{t.compare}</p>
        </>
      )}
      {state.canDownload && (
        <form method="post" action={`/verify/${props.code}/pdf`}>
          {state.name && <input type="hidden" name="name" value={state.name} />}
          <button className="ui-button" type="submit">
            {t.download}
          </button>
        </form>
      )}
      {state.content === "shown" && props.cancelled && (
        <p className="site-muted">{t.noDownloadCancelled}</p>
      )}
    </section>
  );
}
