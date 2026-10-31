import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImageStorage } from "@website/domain/shared";
import { signLink } from "@website/security";

/** Every segment is a plain file or folder name: no `..`, no absolute paths, no backslashes. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export type FileVisibility = "public" | "private";

export function checkFilePath(path: string): string {
  if (!SAFE_PATH.test(path)) throw new Error("Invalid file path.");
  return path;
}

/** Content type from the extension (we only store WebP, PDF and encrypted `.enc` files). */
export const fileContentType = (path: string): string =>
  path.endsWith(".webp")
    ? "image/webp"
    : path.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";

/** Purpose stored in signed file links, so other signed links (unsubscribe…) never open files. */
export const FILE_LINK_PURPOSE = "file";

export interface DiskFileStorageConfig {
  /** FILE_STORAGE_DIR: absolute folder outside every app folder (deploys replace those). */
  readonly root: string;
  /** WEB_URL: the web app serves `/files/<path>` (public) and `/private-files?t=` (signed). */
  readonly baseUrl: string;
  /** LINK_SIGNING_SECRET: signs private links (15 minutes). */
  readonly secret: string | undefined;
  readonly now?: () => Date;
}

/**
 * Uploaded files on the cPanel disk (DEC-12): `<root>/public/<path>` and `<root>/private/<path>`.
 * Public files get a long-cached URL (every upload has a new name); private files (KTM,
 * signatures, portfolios, letters) get no URL — open them through `signedReadUrl` or, on the
 * server, `read`. All apps of the cPanel account share the folder.
 */
export function createDiskFileStorage(config: DiskFileStorageConfig) {
  const now = config.now ?? (() => new Date());
  const fileOf = (visibility: FileVisibility, path: string) =>
    join(config.root, visibility, checkFilePath(path));

  const readOne = async (visibility: FileVisibility, path: string) => {
    try {
      return new Uint8Array(await readFile(fileOf(visibility, path)));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };

  const storage: ImageStorage & {
    signedReadUrl(path: string, minutes?: number): Promise<string>;
    /** The bytes of a stored file (only one visibility when given), null when missing. */
    read(path: string, visibility?: FileVisibility): Promise<Uint8Array | null>;
    /** Deletes a file (replaced signatures); a missing file is not an error. */
    remove(path: string): Promise<void>;
  } = {
    async save(path, bytes, { visibility }) {
      const file = fileOf(visibility, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
      return {
        url: visibility === "public" ? `${config.baseUrl}/files/${path}` : null,
      };
    },
    async read(path, visibility) {
      if (visibility) return readOne(visibility, path);
      return (await readOne("private", path)) ?? readOne("public", path);
    },
    async remove(path) {
      await Promise.all([
        rm(fileOf("private", path), { force: true }),
        rm(fileOf("public", path), { force: true }),
      ]);
    },
    signedReadUrl(path, minutes = 15) {
      if (!config.secret) {
        return Promise.reject(new Error("LINK_SIGNING_SECRET is required for private file links."));
      }
      const token = signLink(
        { purpose: FILE_LINK_PURPOSE, path: checkFilePath(path) },
        config.secret,
        new Date(now().getTime() + minutes * 60_000),
      );
      return Promise.resolve(`${config.baseUrl}/private-files?t=${token}`);
    },
  };
  return storage;
}
