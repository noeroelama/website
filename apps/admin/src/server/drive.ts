import "server-only";
import { createSign } from "node:crypto";

export interface DriveCredentials {
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly impersonate: string;
  readonly folderId: string;
}

export class DriveApiError extends Error {
  override readonly name = "DriveApiError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(`drive_${status}: ${message}`);
    this.status = status;
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const quote = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const FOLDER = "application/vnd.google-apps.folder";

export function createDriveClient(
  credentials: DriveCredentials,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
) {
  let token: { value: string; expiresAt: number } | null = null;

  async function send(
    url: string,
    init: RequestInit,
    ok: (status: number) => boolean = (s) => s < 300,
  ) {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(25_000) });
    if (!ok(response.status)) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new DriveApiError(response.status, body.error?.message ?? "no message");
    }
    return response;
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return token.value;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({
        iss: credentials.clientEmail,
        sub: credentials.impersonate,
        scope: "https://www.googleapis.com/auth/drive",
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp: iat + 3600,
      }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.privateKey);
    const response = await send("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${b64url(signature)}`,
      }).toString(),
    });
    const body = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  const auth = async () => ({ Authorization: `Bearer ${await accessToken()}` });

  async function findOne(name: string, parent: string, folder: boolean) {
    const q = `name = ${quote(name)} and ${quote(parent)} in parents and trashed = false and mimeType ${folder ? "=" : "!="} '${FOLDER}'`;
    const url = `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
      q,
      fields: "files(id,size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "1",
    }).toString()}`;
    const body = (await (await send(url, { headers: await auth() })).json()) as {
      files?: Array<{ id: string; size?: string }>;
    };
    const file = body.files?.[0];
    return file ? { id: file.id, size: Number(file.size ?? 0) } : null;
  }

  return {
    async folder(name: string): Promise<string> {
      const found = await findOne(name, credentials.folderId, true);
      if (found) return found.id;
      const response = await send(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        {
          method: "POST",
          headers: { ...(await auth()), "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: FOLDER, parents: [credentials.folderId] }),
        },
      );
      return ((await response.json()) as { id: string }).id;
    },

    file: (name: string, folderId: string) => findOne(name, folderId, false),

    async startUpload(name: string, folderId: string, size: number): Promise<string> {
      const response = await send(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            ...(await auth()),
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(size),
          },
          body: JSON.stringify({ name, parents: [folderId] }),
        },
      );
      const location = response.headers.get("location");
      if (!location) throw new DriveApiError(response.status, "no upload session");
      return location;
    },

    async putChunk(
      sessionUrl: string,
      chunk: Uint8Array,
      start: number,
      total: number,
    ): Promise<{ done: true; fileId: string } | { done: false; uploaded: number }> {
      const response = await send(
        sessionUrl,
        {
          method: "PUT",
          headers: {
            ...(await auth()),
            "Content-Length": String(chunk.byteLength),
            "Content-Range": `bytes ${start}-${start + chunk.byteLength - 1}/${total}`,
          },
          body: new Uint8Array(chunk),
        },
        (status) => status < 300 || status === 308,
      );
      if (response.status === 308) {
        const range = /bytes=0-(\d+)/.exec(response.headers.get("range") ?? "");
        return { done: false, uploaded: range ? Number(range[1]) + 1 : 0 };
      }
      return { done: true, fileId: ((await response.json()) as { id: string }).id };
    },
  };
}

export type DriveClient = ReturnType<typeof createDriveClient>;
