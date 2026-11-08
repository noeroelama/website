import "server-only";

export interface ZoomCredentials {
  readonly accountId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly hostUser: string;
}

export interface ZoomMeetingInput {
  readonly topic: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly timeZone: string;
  readonly passcode: string;
  readonly joinBeforeHostMinutes: number;
}

export class ZoomApiError extends Error {
  override readonly name = "ZoomApiError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(`zoom_${status}: ${message}`);
    this.status = status;
  }
}

export function zoomErrorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: unknown };
    if (typeof json.message === "string") return json.message;
  } catch {
    const xml = /<message>([^<]*)<\/message>/i.exec(body);
    if (xml) return xml[1] as string;
  }
  return body.slice(0, 200) || "no message";
}

export function createZoomClient(
  credentials: ZoomCredentials,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
) {
  let token: { value: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
    if (!response.ok)
      throw new ZoomApiError(response.status, zoomErrorMessage(await response.text()));
    return response;
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return token.value;
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
      "base64",
    );
    const response = await send(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(credentials.accountId)}`,
      { method: "POST", headers: { Authorization: `Basic ${basic}` } },
    );
    const body = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function api(path: string, method: string, body?: unknown): Promise<Response> {
    return send(`https://api.zoom.us/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  return {
    async createMeeting(input: ZoomMeetingInput): Promise<{ id: string; joinUrl: string }> {
      const response = await api(
        `/users/${encodeURIComponent(credentials.hostUser)}/meetings`,
        "POST",
        {
          topic: input.topic,
          type: 2,
          start_time: input.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
          duration: input.durationMinutes,
          timezone: input.timeZone,
          password: input.passcode,
          settings: {
            join_before_host: input.joinBeforeHostMinutes > 0,
            jbh_time: input.joinBeforeHostMinutes,
            waiting_room: false,
          },
        },
      );
      const body = (await response.json()) as { id: number | string; join_url: string };
      return { id: String(body.id), joinUrl: body.join_url };
    },

    async updateMeeting(id: string, patch: Record<string, unknown>): Promise<void> {
      await api(`/meetings/${encodeURIComponent(id)}`, "PATCH", patch);
    },

    async deleteMeeting(id: string): Promise<void> {
      try {
        await api(`/meetings/${encodeURIComponent(id)}`, "DELETE");
      } catch (error) {
        if (!(error instanceof ZoomApiError && error.status === 404)) throw error;
      }
    },

    async get<T>(path: string): Promise<T> {
      return (await (await api(path, "GET")).json()) as T;
    },

    async download(url: string, range?: { start: number; end: number }): Promise<Response> {
      return send(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        },
      });
    },

    async trashRecording(uuidPath: string): Promise<void> {
      await api(`/meetings/${uuidPath}/recordings?action=trash`, "DELETE");
    },
  };
}

export type ZoomClient = ReturnType<typeof createZoomClient>;
