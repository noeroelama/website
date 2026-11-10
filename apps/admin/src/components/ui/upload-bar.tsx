"use client";

import { Icon } from "./icon";

/**
 * Progress of an image upload (`useImageUpload`) with an X to cancel it. Shows only while the
 * upload runs; put it under the upload's drop zone or button.
 */
export function UploadBar({
  upload,
}: {
  upload: { busy: boolean; progress: number; cancel: () => void };
}) {
  if (!upload.busy) return null;
  const percent = Math.round(upload.progress * 100);
  return (
    <div className="admin-upload-bar" role="status">
      <span className="admin-upload-bar__label">Uploading… {percent}%</span>
      <progress className="admin-upload-bar__track" max={100} value={percent} aria-label="Upload" />
      <button
        type="button"
        className="admin-upload-bar__cancel"
        aria-label="Cancel upload"
        title="Cancel upload"
        onClick={upload.cancel}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
