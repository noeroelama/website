"use client";

import { useRef, useState } from "react";
import type { UploadPlacement } from "@website/domain/documents";
import { placeLetterStampsAction } from "@/app/(panel)/letters/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import type { LetterItem } from "./letters-model";

/* ==================================================================
   Upload path (D3): after "Take number" the author types the number
   into their own document, uploads the PDF (the number is checked
   when the PDF has text) and says where the signatures and the QR
   go. "Preview PDF" shows the stamped file exactly as it will be kept.
   ================================================================== */

type Spot = { page: number; xMm: number; yMm: number };
type Key = "qr" | "secretary" | "coordinator";
type Field = keyof Spot | "sizeMm";
const SPOT_FIELDS: readonly Field[] = ["page", "xMm", "yMm"];
const QR_FIELDS: readonly Field[] = [...SPOT_FIELDS, "sizeMm"];

// PPIDK's defaults: signature lower right of page 1, the QR in the bottom-right corner.
const DEFAULTS: Record<Key, Spot & { sizeMm?: number }> = {
  qr: { page: 1, xMm: 175, yMm: 255, sizeMm: 22 },
  secretary: { page: 1, xMm: 130, yMm: 230 },
  coordinator: { page: 1, xMm: 30, yMm: 230 },
};
const LABELS: Record<Key, string> = {
  qr: "QR and code",
  secretary: "Secretary-General's signature",
  coordinator: "Coordinator's signature",
};

export function LetterUploadPanel(props: {
  letter: LetterItem;
  /** Shows a message and reloads (the letter's version changed). */
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { letter, onDone, onError } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const keys: Key[] = letter.requiresCoordinator
    ? ["qr", "secretary", "coordinator"]
    : ["qr", "secretary"];
  const [placement, setPlacement] = useState<UploadPlacement>(
    letter.placement ?? {
      qr: DEFAULTS.qr as UploadPlacement["qr"],
      secretary: DEFAULTS.secretary,
      coordinator: null,
    },
  );

  const upload = async (file: File) => {
    if (file.type !== "application/pdf") return onError("Upload the document as a PDF.");
    if (file.size > 10 * 1024 * 1024) return onError("The PDF may be at most 10 MB.");
    setBusy(true);
    const response = await fetch(`/api/letters/${letter.id}/file?version=${letter.version}`, {
      method: "POST",
      body: file,
      headers: { "content-type": "application/pdf" },
    });
    setBusy(false);
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      numberChecked?: boolean;
    };
    if (!response.ok)
      return onError(data.message ?? "Upload failed. Reload the page and try again.");
    onDone(
      data.numberChecked
        ? "PDF uploaded: the number was found in it"
        : "PDF uploaded: no text layer (a scan), the number was not checked",
    );
  };

  const save = async () => {
    setBusy(true);
    const result = await placeLetterStampsAction({
      id: letter.id,
      version: letter.version,
      placement,
    });
    setBusy(false);
    if (!result.ok) return onError(actionMessage(result));
    onDone("Positions saved: open the preview to check them");
  };

  const set = (key: Key, field: Field, value: number) => {
    const current = placement[key] ?? DEFAULTS[key];
    setPlacement({ ...placement, [key]: { ...current, [field]: value } });
  };

  return (
    <section className="admin-card admin-letter-upload" aria-label="Final PDF">
      <h2 className="admin-card__title">Final PDF</h2>
      <p className="admin-card__subtitle">
        Type <strong>{letter.numberFormatted}</strong> into the document, export it as PDF and
        upload it here (at most 10 MB, without a password).
        {letter.upload
          ? letter.upload.numberChecked
            ? " The uploaded PDF contains the number."
            : " The uploaded PDF has no text layer (a scan): the number was not checked."
          : ""}
      </p>
      {letter.canEdit ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            icon="upload"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {letter.upload ? "Replace PDF" : "Upload PDF"}
          </Button>
          <p className="admin-card__subtitle">
            Where to stamp, in mm from the top-left corner of the page (signatures appear once that
            desk has signed, at the signer&apos;s own width).
          </p>
          {keys.map((key) => {
            const spot = placement[key];
            return (
              <fieldset key={key} className="admin-form-grid">
                <legend className="admin-field__label">
                  <label>
                    <input
                      type="checkbox"
                      checked={spot !== null}
                      onChange={(e) =>
                        setPlacement({
                          ...placement,
                          [key]: e.target.checked ? DEFAULTS[key] : null,
                        })
                      }
                    />{" "}
                    {LABELS[key]}
                  </label>
                </legend>
                {spot
                  ? (key === "qr" ? QR_FIELDS : SPOT_FIELDS).map((field) => (
                      <label key={field} className="admin-field">
                        <span className="admin-field__label">
                          {field === "page"
                            ? "Page"
                            : field === "xMm"
                              ? "From left (mm)"
                              : field === "yMm"
                                ? "From top (mm)"
                                : "Size (mm)"}
                        </span>
                        <input
                          className="admin-input"
                          type="number"
                          min={field === "page" ? 1 : field === "sizeMm" ? 15 : 0}
                          max={field === "sizeMm" ? 40 : undefined}
                          value={(spot as Record<string, number>)[field] ?? ""}
                          onChange={(e) => set(key, field, Number(e.target.value))}
                        />
                      </label>
                    ))
                  : null}
              </fieldset>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            icon="cloud"
            disabled={busy}
            onClick={() => void save()}
          >
            Save positions
          </Button>
        </>
      ) : null}
    </section>
  );
}
