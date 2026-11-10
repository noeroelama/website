"use client";

import { useCallback, useRef, useState } from "react";
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

/**
 * POST a file and report how much is sent (0–1). `fetch` cannot report upload progress, so this
 * uses XMLHttpRequest. Resolves "cancelled" when `signal` aborts; rejects on a network error.
 */
export function sendImage(
  url: string,
  body: Blob | string,
  contentType: string,
  onProgress: (sent: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data: unknown } | "cancelled"> {
  if (signal?.aborted) return Promise.resolve("cancelled");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON (e.g. a proxy error page): the status still says it failed.
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => resolve("cancelled");
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export function useImageUpload(preset: ImagePresetName) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);

  const upload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      setError(null);
      const problem = checkImageFile(file);
      if (problem) {
        setError(IMAGE_ERROR_MESSAGES[problem]);
        return null;
      }
      const controller = new AbortController();
      running.current = controller;
      setProgress(0);
      setBusy(true);
      try {
        const body = await compress(file, IMAGE_PRESETS[preset].maxPx).catch(() => file);
        const result = await sendImage(
          `/api/uploads/${preset}`,
          body,
          body.type || file.type,
          setProgress,
          controller.signal,
        );
        if (result === "cancelled") return null;
        const data = result.data as UploadedImage & { message?: string };
        if (!result.ok) {
          setError(data.message ?? "Upload failed. Try again.");
          return null;
        }
        return data;
      } catch {
        setError("Upload failed. Check your connection and try again.");
        return null;
      } finally {
        running.current = null;
        setBusy(false);
      }
    },
    [preset],
  );

  /** Stop the running upload (the X on the upload bar); `upload` then returns null. */
  const cancel = useCallback(() => running.current?.abort(), []);

  return { upload, busy, progress, error, cancel };
}
