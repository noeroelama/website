import "server-only";
import {
  checkFilePath,
  type createDiskFileStorage,
  fileContentType,
  FILE_LINK_PURPOSE,
} from "@website/db/sql";
import { verifyLink } from "@website/security";

type FileStorage = ReturnType<typeof createDiskFileStorage>;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

const isSafePath = (path: string) => {
  try {
    checkFilePath(path);
    return true;
  } catch {
    return false;
  }
};

export function createFileRoutes(deps: {
  storage: () => FileStorage;
  secret: () => string | undefined;
  now: () => Date;
}) {
  const send = (bytes: Uint8Array, path: string, cacheControl: string) =>
    new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": fileContentType(path),
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  return {
    async publicFile(segments: readonly string[]): Promise<Response> {
      const path = segments.join("/");
      if (!isSafePath(path)) return notFound();
      const bytes = await deps.storage().read(path, "public");
      return bytes ? send(bytes, path, "public, max-age=31536000, immutable") : notFound();
    },
    async privateFile(token: string | null): Promise<Response> {
      const secret = deps.secret();
      const data = token && secret ? verifyLink(token, secret, deps.now()) : null;
      const path = data?.["purpose"] === FILE_LINK_PURPOSE ? data["path"] : undefined;
      if (!path || !isSafePath(path)) return notFound();
      const bytes = await deps.storage().read(path, "private");
      return bytes ? send(bytes, path, "private, no-store") : notFound();
    },
  };
}
