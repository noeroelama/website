"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";

export function PactUpload(props: { recruitmentId: string; labels: Dictionary["recruitment"] }) {
  const router = useRouter();
  const t = props.labels;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMessage(t.uploading);
    try {
      const response = await fetch(`/api/recruitment/${props.recruitmentId}/portfolio?pact`, {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/pdf",
          "X-File-Name": encodeURIComponent(file.name),
        },
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      setMessage(
        body.ok
          ? t.pactUploaded
          : body.error === "not_pdf"
            ? t.notPdf
            : body.error === "too_large"
              ? t.tooLarge
              : t.failed,
      );
      if (body.ok) router.refresh();
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ui-field">
      <label htmlFor="pact">{t.pactUpload}</label>
      <input
        id="pact"
        className="ui-input"
        type="file"
        accept="application/pdf"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
