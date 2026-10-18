import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { AuditEvent } from "@website/audit";
import {
  detectImageType,
  IMAGE_ERROR_MESSAGES,
  IMAGE_PRESETS,
  IMAGE_QUALITY,
  imagePaths,
  MAX_IMAGE_BYTES,
  RuleViolationError,
  THUMBNAIL_WIDTH,
  type ImagePresetName,
  type ImageStorage,
} from "@website/domain/shared";
import { type AdminPageId, type PagePermission, type Principal } from "@website/permissions";
import { jsonError } from "@website/security";
import { createGuardedAction, type AuditContext } from "./guarded-action";

/** Which admin page may upload which kind of image (signatures are uploaded on web, later). */
export const ADMIN_UPLOAD_PRESETS = {
  banner: "events.edit",
  speaker: "events.edit",
  thumbnail: "articles.edit",
  newsletter: "newsletter.edit",
  gallery: "gallery.edit",
  logo: "organizations.edit",
  ktm: "members.edit",
} as const satisfies Partial<Record<ImagePresetName, PagePermission>>;
type AdminPreset = keyof typeof ADMIN_UPLOAD_PRESETS;
const isAdminPreset = (name: string): name is AdminPreset =>
  Object.hasOwn(ADMIN_UPLOAD_PRESETS, name);

export interface ImageUploadDeps {
  readonly storage: ImageStorage;
  /** Writes one audit entry in its own transaction (no record changes with an upload). */
  readonly appendAudit: (event: AuditEvent) => Promise<void>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

/** Re-encodes: EXIF orientation applied, inside maxPx, WebP q82, metadata stripped (sharp default). */
async function encode(bytes: Uint8Array, preset: AdminPreset) {
  try {
    const { maxPx } = IMAGE_PRESETS[preset];
    const main = await sharp(bytes, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(main.data)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer();
    return { main: main.data, thumb, width: main.info.width, height: main.info.height };
  } catch {
    throw new RuleViolationError(IMAGE_ERROR_MESSAGES.unsupported_type);
  }
}

/** Reads the body, refusing (null) as soon as it passes the 5 MB limit. */
async function readLimited(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES) return null;
      chunks.push(chunk);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * POST /api/uploads/<preset> (flowchart section 2): the page permission is checked BEFORE the
 * body is read (the guarded action's handler reads it), body ≤ 5 MB, real type from the bytes,
 * re-encode + 480 px thumbnail, store both, audit UPLOAD, and answer
 * `{ path, thumbPath, url, thumbUrl, width, height }` (URLs null for private presets).
 */
export function createImageUploads(deps: ImageUploadDeps) {
  const actionFor = (preset: AdminPreset) =>
    createGuardedAction({
      permission: ADMIN_UPLOAD_PRESETS[preset],
      input: z.object({ request: z.instanceof(Request) }).strict(),
      handler: async ({ request }, _principal, audit) => {
        const bytes = await readLimited(request);
        if (bytes === null) return "too_large" as const;
        if (detectImageType(bytes) === null) {
          throw new RuleViolationError(IMAGE_ERROR_MESSAGES.unsupported_type);
        }
        const image = await encode(bytes, preset);
        const { path, thumbPath } = imagePaths(preset, deps.now(), deps.uuid());
        const { visibility } = IMAGE_PRESETS[preset];
        const [main, thumb] = await Promise.all([
          deps.storage.save(path, image.main, { visibility }),
          deps.storage.save(thumbPath, image.thumb, { visibility }),
        ]);
        await deps.appendAudit(
          audit({
            module: ADMIN_UPLOAD_PRESETS[preset].split(".")[0] as AdminPageId,
            action: "UPLOAD",
            resourceType: "image",
            resourceId: path.replace(/[^A-Za-z0-9_-]/g, "_"),
            title: `${preset} image`,
            before: null,
            after: { path, thumbPath, width: image.width, height: image.height },
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        );
        return {
          path,
          thumbPath,
          url: main.url,
          thumbUrl: thumb.url,
          width: image.width,
          height: image.height,
        };
      },
    });

  return async (
    preset: string,
    request: Request,
    getPrincipal: () => Promise<Principal | null>,
    getAuditContext: () => Promise<AuditContext>,
  ): Promise<Response> => {
    if (!isAdminPreset(preset)) return Response.json({ error: "not_found" }, { status: 404 });
    const result = await actionFor(preset)(getPrincipal, getAuditContext)({ request });
    if (result.ok && result.data === "too_large") {
      return Response.json(
        { error: "invalid_input", message: IMAGE_ERROR_MESSAGES.too_large },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (result.ok) {
      return Response.json(result.data, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (result.error === "refused") {
      return Response.json(
        { error: "invalid_input", message: result.issues?.[0] },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return jsonError(result.error === "unauthenticated" ? "unauthenticated" : "forbidden");
  };
}
