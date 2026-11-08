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

export function checkImageFile(file: { type: string; size: number }): ImageCheckError | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((value, i) => bytes[offset + i] === value);

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

export interface ImagePreset {
  readonly folder: string;
  readonly maxPx: number;
  readonly visibility: "public" | "private";
}

export const IMAGE_PRESETS = {
  banner: { folder: "events/banners", maxPx: 2400, visibility: "public" },
  speaker: { folder: "events/speakers", maxPx: 1024, visibility: "public" },
  thumbnail: { folder: "content/images", maxPx: 2400, visibility: "public" },
  newsletter: { folder: "newsletter/images", maxPx: 1600, visibility: "public" },
  gallery: { folder: "galleries", maxPx: 2400, visibility: "public" },
  logo: { folder: "chapters/logos", maxPx: 1024, visibility: "public" },
  cabinet: { folder: "structure/photos", maxPx: 1024, visibility: "public" },
  ktm: { folder: "members/ktm", maxPx: 2400, visibility: "private" },
  signature: { folder: "members/signatures", maxPx: 1200, visibility: "private" },
  letterhead: { folder: "letters/letterhead", maxPx: 2400, visibility: "public" },
} as const satisfies Record<string, ImagePreset>;
export type ImagePresetName = keyof typeof IMAGE_PRESETS;

export function imagePaths(
  preset: ImagePresetName,
  now: Date,
  uuid: string,
): { path: string; thumbPath: string } {
  const base = `${IMAGE_PRESETS[preset].folder}/${preset}_${now.getTime()}_${uuid.replace(/-/g, "").slice(0, 8)}`;
  return { path: `${base}.webp`, thumbPath: `${base}_thumb.webp` };
}

export interface ImageStorage {
  save(
    path: string,
    bytes: Uint8Array,
    options: {
      visibility: ImagePreset["visibility"];
      contentType?: "image/webp" | "application/pdf" | "application/octet-stream";
    },
  ): Promise<{ url: string | null }>;
}
