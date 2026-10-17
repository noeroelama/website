"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Small square photo uploader used in the guest/speaker, sponsor and unit
 *  member panels. Reads the picked file as a data-URL (max 5 MB); the well
 *  shows the image once set, with a small clear button on the corner. */
export function PhotoDrop({
  value,
  label,
  onPick,
  onClear,
}: {
  value: string | null;
  label: string;
  onPick: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const handleFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => onPick(reader.result as string);
    reader.readAsDataURL(file);
  };
  return (
    <div
      className="admin-photo"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ref.current?.click();
        }
      }}
    >
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URL upload, not optimizable */}
          <img src={value} alt="" className="admin-photo__img" />
          <Button
            variant="ghost"
            size="icon"
            icon="x"
            className="admin-photo__clear"
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          />
        </>
      ) : (
        <Icon name="user" size={20} />
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
