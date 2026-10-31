import "server-only";
import type { SqlSignatureStore } from "@website/db/sql";
import {
  MAX_SIGNATURE_BYTES,
  SignatureSettingsSchema,
  signaturePath,
  type SignatureSettings,
} from "@website/domain/documents";
import { detectImageType } from "@website/domain/shared";
import { decryptField, encryptField, jsonError, readBodyLimited } from "@website/security";

export interface SignatureDeps {
  readonly store: Pick<SqlSignatureStore, "get" | "replace" | "configure" | "remove">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    read(path: string): Promise<Uint8Array | null>;
    remove(path: string): Promise<void>;
  };
  /** FIELD_ENCRYPTION_KEY; null = signatures are off. */
  readonly key: () => string | null;
  readonly now: () => Date;
  readonly uuid: () => string;
}

export type SignatureOwner = { readonly uid: string } | null;

const noStore = { "Cache-Control": "private, no-store" };
/** Error codes the page turns into its own words. */
type Refusal = "off" | "settings" | "too_large" | "not_image";
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });

/**
 * The signed-in person's own signature (/account/signature, D4). Always keyed by the session's
 * uid: nobody — not even a superadmin — can see or replace another person's signature here.
 */
export function createOwnSignature(deps: SignatureDeps) {
  /** The current settings (and a version for the preview's address), null when there is none. */
  async function settings(
    owner: SignatureOwner,
  ): Promise<(SignatureSettings & { version: number }) | null> {
    if (!owner) return null;
    const stored = await deps.store.get(owner.uid);
    return (
      stored && {
        widthMm: stored.widthMm,
        rotation: stored.rotation,
        version: stored.updatedAt.getTime(),
      }
    );
  }

  /** POST /api/account/signature?widthMm=&rotation= with the PNG or JPEG as the body (≤ 2 MB). */
  async function upload(owner: SignatureOwner, request: Request): Promise<Response> {
    if (!owner) return jsonError("unauthenticated");
    const key = deps.key();
    if (!key) return refused("off", 503);
    const query = new URL(request.url).searchParams;
    const parsed = SignatureSettingsSchema.safeParse({
      widthMm: Number(query.get("widthMm") ?? 40),
      rotation: Number(query.get("rotation") ?? 0),
    });
    if (!parsed.success) return refused("settings");
    const bytes = await readBodyLimited(request, MAX_SIGNATURE_BYTES);
    if (bytes === null) return refused("too_large", 413);
    const type = detectImageType(bytes);
    if (type !== "image/png" && type !== "image/jpeg") return refused("not_image");
    // New file first, the old one removed afterwards: a failed upload never loses the signature.
    const path = signaturePath(owner.uid, deps.uuid());
    await deps.storage.save(path, new TextEncoder().encode(encryptField(bytes, key)), {
      visibility: "private",
      contentType: "application/octet-stream",
    });
    const previous = await deps.store.replace(
      owner.uid,
      { path, type: type === "image/png" ? "png" : "jpeg", ...parsed.data },
      deps.now(),
    );
    if (previous && previous !== path) await deps.storage.remove(previous);
    return Response.json({ ok: true }, { status: 201, headers: noStore });
  }

  /** GET /api/account/signature: the owner's own image (decrypted), for the preview only. */
  async function view(owner: SignatureOwner): Promise<Response> {
    if (!owner) return jsonError("unauthenticated");
    const key = deps.key();
    const stored = await deps.store.get(owner.uid);
    const file = stored && key ? await deps.storage.read(stored.path) : null;
    if (!stored || !key || !file) return new Response(null, { status: 404, headers: noStore });
    return new Response(new Uint8Array(decryptField(new TextDecoder().decode(file), key)), {
      headers: {
        ...noStore,
        "Content-Type": stored.type === "png" ? "image/png" : "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  /** Width / rotation without a new upload. */
  async function configure(owner: SignatureOwner, raw: unknown) {
    if (!owner) return { ok: false as const, error: "signin" as const };
    const parsed = SignatureSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, error: "invalid" as const };
    const done = await deps.store.configure(owner.uid, parsed.data, deps.now());
    return done ? { ok: true as const } : { ok: false as const, error: "none" as const };
  }

  async function remove(owner: SignatureOwner) {
    if (!owner) return { ok: false as const, error: "signin" as const };
    const path = await deps.store.remove(owner.uid);
    if (path) await deps.storage.remove(path);
    return { ok: true as const };
  }

  return { settings, upload, view, configure, remove };
}
