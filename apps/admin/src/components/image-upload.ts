"use client";

import { useCallback, useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import {
  checkImageFile,
  IMAGE_ERROR_MESSAGES,
  IMAGE_PRESETS,
  IMAGE_QUALITY,
  type ImagePresetName,
} from "@website/domain/shared";

/** What POST /api/uploads/<preset> answers. URLs are null for private presets. */
export interface UploadedImage {
  readonly path: string;
  readonly thumbPath: string;
  readonly url: string | null;
  readonly thumbUrl: string | null;
  readonly width: number;
  readonly height: number;
}

/** Stored form of an upload from a public preset (both URLs set); null for a private preset. */
export function publicImage(image: UploadedImage): FeaturedImage | null {
  if (!image.url || !image.thumbUrl) return null;
  const { url, thumbUrl, path, thumbPath, width, height } = image;
  return { url, thumbUrl, path, thumbPath, width, height };
}

/**
 * Shrinks the image in the browser before upload (WebP, inside the preset's size) with the
 * native canvas — no library. `createImageBitmap` applies the EXIF orientation. Browsers that
 * cannot encode WebP give another type; the server re-encodes either way, so keep the smaller.
 */
async function compress(file: File, maxPx: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: IMAGE_QUALITY / 100 });
  return blob.size < file.size ? blob : file;
}

/**
 * Flowchart section 2 in the browser: type and 5 MB checks first (nothing is uploaded when
 * they fail), compression, then POST to the server, which checks everything again.
 */
export function useImageUpload(preset: ImagePresetName) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      setError(null);
      const problem = checkImageFile(file);
      if (problem) {
        setError(IMAGE_ERROR_MESSAGES[problem]);
        return null;
      }
      setBusy(true);
      try {
        const body = await compress(file, IMAGE_PRESETS[preset].maxPx).catch(() => file);
        const response = await fetch(`/api/uploads/${preset}`, {
          method: "POST",
          body,
          headers: { "content-type": body.type || file.type },
        });
        const data = (await response.json()) as UploadedImage & { message?: string };
        if (!response.ok) {
          setError(data.message ?? "Upload failed. Try again.");
          return null;
        }
        return data;
      } catch {
        setError("Upload failed. Check your connection and try again.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [preset],
  );

  return { upload, busy, error };
}
