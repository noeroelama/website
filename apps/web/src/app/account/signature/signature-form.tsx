"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { configureSignatureAction, removeSignatureAction } from "./actions";

type Current = { widthMm: number; rotation: number; version: number } | null;

export function SignatureForm(props: { t: Dictionary["signature"]; current: Current }) {
  const { t, current } = props;
  const router = useRouter();
  const [widthMm, setWidthMm] = useState(current?.widthMm ?? 40);
  const [rotation, setRotation] = useState(current?.rotation ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const finish = (text: string, ok: boolean) => {
    setMessage(text);
    if (ok) router.refresh();
  };

  const upload = async (file: File) => {
    setBusy(true);
    setMessage(t.uploading);
    try {
      const response = await fetch(
        `/api/account/signature?widthMm=${widthMm}&rotation=${rotation}`,
        { method: "POST", body: file, headers: { "Content-Type": file.type || "image/png" } },
      );
      const body = (await response.json()) as { ok?: boolean; error?: string };
      const refusals: Record<string, string> = {
        off: t.off,
        too_large: t.tooLarge,
        not_image: t.notImage,
        settings: t.invalid,
      };
      finish(body.ok ? t.saved : (refusals[body.error ?? ""] ?? t.failed), body.ok === true);
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    const result = await configureSignatureAction({ widthMm, rotation });
    setBusy(false);
    finish(result.ok ? t.saved : result.error === "invalid" ? t.invalid : t.failed, result.ok);
  };

  const remove = async () => {
    setBusy(true);
    const result = await removeSignatureAction();
    setBusy(false);
    finish(result.ok ? t.removed : t.failed, result.ok);
  };

  return (
    <div className="ui-form">
      {current ? (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- private, decrypted per request */}
          <img
            src={`/api/account/signature?v=${current.version}`}
            alt={t.preview}
            style={{ width: `${current.widthMm}mm`, transform: `rotate(${current.rotation}deg)` }}
          />
          <figcaption>{t.preview}</figcaption>
        </figure>
      ) : (
        <p>{t.none}</p>
      )}
      <label className="ui-field">
        {t.widthMm}
        <input
          className="ui-input"
          type="number"
          min={10}
          max={80}
          value={widthMm}
          onChange={(e) => setWidthMm(Number(e.target.value))}
        />
      </label>
      <label className="ui-field">
        {t.rotation}
        <input
          className="ui-input"
          type="number"
          min={-180}
          max={180}
          value={rotation}
          onChange={(e) => setRotation(Number(e.target.value))}
        />
      </label>
      {current && (
        <button className="ui-button" type="button" disabled={busy} onClick={() => void save()}>
          {t.save}
        </button>
      )}
      <label className="ui-field">
        {current ? t.replace : t.upload}
        <input
          className="ui-input"
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      <small>{t.hint}</small>
      {current && (
        <button className="ui-button" type="button" disabled={busy} onClick={() => void remove()}>
          {t.remove}
        </button>
      )}
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
