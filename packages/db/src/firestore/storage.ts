import { randomUUID } from "node:crypto";
import type { App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { ImageStorage } from "@website/domain/shared";

const LONG_CACHE = "public, max-age=31536000, immutable";

/**
 * Firebase Storage for images (DEC-12). Public files get a download-token URL that browsers and
 * CDNs may cache for a year (every upload has a new name); private files (KTM, signatures) get
 * no URL — read them through `signedReadUrl` (15 minutes).
 */
export function createFirebaseImageStorage(app: App, bucketName: string) {
  const bucket = getStorage(app).bucket(bucketName);
  const storage: ImageStorage & {
    signedReadUrl(path: string, minutes?: number): Promise<string>;
  } = {
    async save(path, bytes, { visibility }) {
      const token = visibility === "public" ? randomUUID() : null;
      await bucket.file(path).save(Buffer.from(bytes), {
        resumable: false,
        contentType: "image/webp",
        metadata: {
          cacheControl: token ? LONG_CACHE : "private, no-store",
          ...(token ? { metadata: { firebaseStorageDownloadTokens: token } } : {}),
        },
      });
      return {
        url: token
          ? `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
          : null,
      };
    },
    async signedReadUrl(path, minutes = 15) {
      const [url] = await bucket
        .file(path)
        .getSignedUrl({ action: "read", expires: Date.now() + minutes * 60_000 });
      return url;
    },
  };
  return storage;
}
