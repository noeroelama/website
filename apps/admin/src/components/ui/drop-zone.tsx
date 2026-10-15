"use client";

import { useRef } from "react";
import { Icon } from "./icon";

/**
 * Presentational drop zone: pick or drag ONE file. It does not check or upload anything —
 * pair it with `useImageUpload` (src/components/image-upload.ts) or another handler.
 */
export function DropZone({
  label,
  hint,
  previewUrl,
  busy = false,
  error,
  accept = "image/jpeg,image/png,image/webp",
  onFile,
}: {
  label: string;
  hint: string;
  previewUrl?: string | null;
  busy?: boolean;
  error?: string | null;
  accept?: string;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="admin-field">
      <button
        type="button"
        className="admin-dropzone"
        aria-busy={busy}
        aria-invalid={error ? true : undefined}
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded file, already WebP
          <img src={previewUrl} alt="" className="admin-dropzone__image" />
        ) : (
          <>
            <Icon name="plus" size={28} />
            <span className="admin-dropzone__title">{busy ? "Uploading…" : label}</span>
            <span className="admin-card__subtitle">{hint}</span>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="admin-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
