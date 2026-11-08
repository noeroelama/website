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

export interface UploadedImage {
  readonly path: string;
  readonly thumbPath: string;
  readonly url: string | null;
  readonly thumbUrl: string | null;
  readonly width: number;
  readonly height: number;
}

export function publicImage(image: UploadedImage): FeaturedImage | null {
  if (!image.url || !image.thumbUrl) return null;
  const { url, thumbUrl, path, thumbPath, width, height } = image;
  return { url, thumbUrl, path, thumbPath, width, height };
}

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
