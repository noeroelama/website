import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImageStorage } from "@website/domain/shared";
import { signLink } from "@website/security";
import type { Database } from "./store";

const SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export type FileVisibility = "public" | "private";

export function checkFilePath(path: string): string {
  if (!SAFE_PATH.test(path)) throw new Error("Invalid file path.");
  return path;
}

export const fileContentType = (path: string): string =>
  path.endsWith(".webp")
    ? "image/webp"
    : path.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";

export const FILE_LINK_PURPOSE = "file";

function signedReadUrl(
  config: Pick<DiskFileStorageConfig, "baseUrl" | "secret" | "now">,
  path: string,
  minutes = 15,
): Promise<string> {
  if (!config.secret) {
    return Promise.reject(new Error("LINK_SIGNING_SECRET is required for private file links."));
  }
  const token = signLink(
    { purpose: FILE_LINK_PURPOSE, path: checkFilePath(path) },
    config.secret,
    new Date((config.now ?? (() => new Date()))().getTime() + minutes * 60_000),
  );
  return Promise.resolve(`${config.baseUrl}/private-files?t=${token}`);
}

export interface DiskFileStorageConfig {
  readonly root: string;
  readonly baseUrl: string;
  readonly secret: string | undefined;
  readonly now?: () => Date;
}

export function createDiskFileStorage(config: DiskFileStorageConfig) {
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
    read(path: string, visibility?: FileVisibility): Promise<Uint8Array | null>;
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
    signedReadUrl: (path, minutes) => signedReadUrl(config, path, minutes),
  };
  return storage;
}

export function createDbFileStorage(
  config: Omit<DiskFileStorageConfig, "root"> & { db: Database },
) {
  const files = config.db.collection("files");
  const ref = (visibility: FileVisibility, path: string) =>
    files.doc(`${visibility}/${checkFilePath(path)}`);
  const readOne = async (visibility: FileVisibility, path: string) => {
    const snapshot = await ref(visibility, path).get();
    return snapshot.exists
      ? new Uint8Array(Buffer.from(snapshot.data()?.["bytes"] as string, "base64"))
      : null;
  };
  const storage: ReturnType<typeof createDiskFileStorage> = {
    async save(path, bytes, { visibility }) {
      await ref(visibility, path).set({ bytes: Buffer.from(bytes).toString("base64") });
      return { url: visibility === "public" ? `${config.baseUrl}/files/${path}` : null };
    },
    async read(path, visibility) {
      if (visibility) return readOne(visibility, path);
      return (await readOne("private", path)) ?? readOne("public", path);
    },
    async remove(path) {
      await Promise.all([ref("private", path).delete(), ref("public", path).delete()]);
    },
    signedReadUrl: (path, minutes) => signedReadUrl(config, path, minutes),
  };
  return storage;
}
