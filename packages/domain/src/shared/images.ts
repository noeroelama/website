/**
 * Image upload rules shared by the browser check and the server (Figma flowchart section 2,
 * DEC-12): jpg/jpeg/png/webp only, at most 5 MB, stored as WebP with a 480 px thumbnail.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const IMAGE_QUALITY = 82;
export const THUMBNAIL_WIDTH = 480;

export type ImageCheckError = "unsupported_type" | "too_large";
export const IMAGE_ERROR_MESSAGES: Record<ImageCheckError, string> = {
  unsupported_type: "File type not supported",
  too_large: "Maximum file size is 5 MB",
};

/** Browser-side (and header) check before anything is uploaded. */
export function checkImageFile(file: { type: string; size: number }): ImageCheckError | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((value, i) => bytes[offset + i] === value);

/** The real type from the first bytes ("magic bytes"); SVG and anything else → null. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

export interface ImagePreset {
  /** Storage folder. */
  readonly folder: string;
  /** Longest side after re-encoding (and the browser's compression target). */
  readonly maxPx: number;
  /** public: long-cached download URL; private: path only, read through 15-minute signed URLs. */
  readonly visibility: "public" | "private";
}

/** One preset per kind of image field. */
export const IMAGE_PRESETS = {
  banner: { folder: "events/banners", maxPx: 2400, visibility: "public" },
  speaker: { folder: "events/speakers", maxPx: 1024, visibility: "public" },
  thumbnail: { folder: "content/images", maxPx: 2400, visibility: "public" },
  gallery: { folder: "galleries", maxPx: 2400, visibility: "public" },
  logo: { folder: "chapters/logos", maxPx: 1024, visibility: "public" },
  ktm: { folder: "members/ktm", maxPx: 2400, visibility: "private" },
  signature: { folder: "members/signatures", maxPx: 1200, visibility: "private" },
} as const satisfies Record<string, ImagePreset>;
export type ImagePresetName = keyof typeof IMAGE_PRESETS;

/** `<folder>/<preset>_<timestamp>_<uuid8>.webp` and the `_thumb.webp` next to it. */
export function imagePaths(
  preset: ImagePresetName,
  now: Date,
  uuid: string,
): { path: string; thumbPath: string } {
  const base = `${IMAGE_PRESETS[preset].folder}/${preset}_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}`;
  return { path: `${base}.webp`, thumbPath: `${base}_thumb.webp` };
}

/** Storage port (Firebase Storage in @website/db). */
export interface ImageStorage {
  /** Stores a WebP file; returns its long-cached URL for public files, null for private ones. */
  save(
    path: string,
    bytes: Uint8Array,
    options: { visibility: ImagePreset["visibility"] },
  ): Promise<{ url: string | null }>;
}
