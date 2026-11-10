import { generateKeyPairSync, createVerify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqlZoomStore } from "@website/db/sql";
import {
  archiveNames,
  isArchived,
  zoomUuidPath,
  CHUNK_BYTES,
  type RecordingFile,
} from "@website/domain/zoom";
import { createDriveClient, DriveApiError } from "../../apps/admin/src/server/drive";
import {
  createRecordingArchive,
  LATE_FILE_WINDOW_MS,
  MAX_ATTEMPTS,
} from "../../apps/admin/src/server/recordings";
import { ZoomApiError } from "../../apps/admin/src/server/zoom-client";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlZoomStore>[0];
const clock = new Date("2026-11-11T00:00:00Z");
let fake: ReturnType<typeof fakeDb>;
const store = () => createSqlZoomStore(fake.db as unknown as Db);

const bookingDoc = {
  topic: "Rapat: kerja/1",
  startsAt: new Date("2026-11-10T16:00:00Z"),
  endsAt: new Date("2026-11-10T17:00:00Z"),
  timeZone: "Asia/Tokyo",
  passcode: "p",
  joinBeforeHostMinutes: 0,
  meetingId: null,
  requestedBy: "req",
  orgUnitId: null,
  orgUnitPath: [],
  status: "approved",
  decidedBy: null,
  decisionNote: null,
  zoomMeetingId: "812",
  joinUrl: "https://zoom.us/j/812",
  shortUrl: null,
  roomError: null,
  closedAt: null,
  recordingUuids: ["s/1=="],
  version: 3,
  createdAt: clock,
  updatedAt: clock,
  deletedAt: null,
};

function world(
  options: {
    driveHas?: Record<string, number>;
    zoomFiles?: unknown[] | null;
    failDownload?: boolean;
    listError?: Error;
  } = {},
) {
  const big = CHUNK_BYTES * 2 + 1000;
  const zoomFiles =
    options.zoomFiles !== undefined
      ? options.zoomFiles
      : [
          {
            id: "f-video",
            recording_type: "shared_screen_with_speaker_view",
            file_extension: "MP4",
            file_size: big,
            download_url: "https://zoom.us/rec/video",
            status: "completed",
          },
          {
            id: "f-chat",
            recording_type: "chat_file",
            file_extension: "TXT",
            file_size: 10,
            download_url: "https://zoom.us/rec/chat",
            status: "completed",
          },
          {
            id: "f-wait",
            recording_type: "audio_only",
            file_extension: "M4A",
            file_size: 5,
            download_url: "https://zoom.us/rec/x",
            status: "processing",
          },
        ];
  const log: string[] = [];
  const received = new Map<string, number>();
  const client = {
    get: <T>(path: string) => {
      log.push(`GET ${path}`);
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve((zoomFiles === null ? {} : { recording_files: zoomFiles }) as T);
    },
    download: (url: string, range?: { start: number; end: number }) => {
      if (options.failDownload) return Promise.reject(new Error("zoom_500: down"));
      log.push(`DL ${url} ${range?.start}-${range?.end}`);
      const length = (range?.end ?? 0) - (range?.start ?? 0) + 1;
      return Promise.resolve(new Response(new Uint8Array(length)));
    },
    trashRecording: (uuid: string) => {
      log.push(`TRASH ${uuid}`);
      return Promise.resolve();
    },
  };
  const drive = {
    folder: (name: string) => Promise.resolve(`folder:${name}`),
    file: (name: string) => {
      const size = options.driveHas?.[name];
      return Promise.resolve(size === undefined ? null : { id: `drive:${name}`, size });
    },
    startUpload: (name: string) => Promise.resolve(`session:${name}`),
    putChunk: (session: string, chunk: Uint8Array, start: number, total: number) => {
      const have = start + chunk.byteLength;
      received.set(session, have);
      return Promise.resolve(
        have >= total
          ? { done: true as const, fileId: `id:${session}` }
          : { done: false as const, uploaded: have },
      );
    },
  };
  return { client, drive, log, received };
}

const archive = (w: ReturnType<typeof world> | null, errors: string[] = [], now = clock) =>
  createRecordingArchive({
    zoom: store(),
    client: w?.client ?? null,
    drive: w?.drive ?? null,
    logError: (message) => errors.push(message),
    now: () => now,
  });
const dayLater = new Date(clock.getTime() + LATE_FILE_WINDOW_MS + 60_000);

beforeEach(async () => {
  fake = fakeDb();
  fake.docs.set("zoomRequests/b1", { ...bookingDoc });
  await store().addSession("s/1==", "b1", clock);
  await store().addSession("s/1==", "b1", clock);
});

describe("recording archive rules (F3)", () => {
  it("names, UUID paths and the read-time archived flag", () => {
    expect(
      archiveNames(bookingDoc, {
        recordingType: "shared_screen_with_speaker_view",
        extension: "MP4",
      }),
    ).toEqual({
      folderName: "[2026-11-11] Rapat kerja 1",
      fileName: "Rapat kerja 1 - shared screen with speaker view.mp4",
    });
    expect(
      archiveNames({ ...bookingDoc, topic: "///" }, { recordingType: "", extension: "vtt" }),
    ).toEqual({
      folderName: "[2026-11-11] Zoom",
      fileName: "Zoom - recording.vtt",
    });
    expect(zoomUuidPath("abc==")).toBe("abc%3D%3D");
    expect(zoomUuidPath("/ab")).toBe("%252Fab");
    expect(zoomUuidPath("a//b")).toBe("a%252F%252Fb");
    const done = { sessionUuid: "s1", status: "done" as const };
    expect(isArchived([], [])).toBe(false);
    expect(isArchived(["s1"], [done])).toBe(true);
    expect(isArchived(["s1", "s2"], [done])).toBe(false);
    expect(isArchived(["s1"], [done, { sessionUuid: "s1", status: "clash" }])).toBe(false);
  });
});

describe("recording archive job (F3)", () => {
  it("does nothing until Zoom and Drive are set up", async () => {
    expect(await archive(null)()).toEqual({ configured: false });
  });

  it("lists every session once (after the late-file window), then moves one chunk per call", async () => {
    const w = world();
    expect(await archive(w, [], dayLater)()).toMatchObject({
      listed: 1,
      status: "uploading",
      uploaded: CHUNK_BYTES,
    });
    const files = await store().filesForBookings(["b1"]);
    expect(files.map((f) => f.id).sort()).toEqual(["f-chat", "f-video"]);
    expect(await store().unlistedSessions(5)).toEqual([]);
    expect(await archive(w, [], dayLater)()).toMatchObject({
      listed: 0,
      status: "uploading",
      uploaded: CHUNK_BYTES * 2,
    });
    expect(await archive(w, [], dayLater)()).toMatchObject({ status: "done" });
    expect(await archive(w, [], dayLater)()).toMatchObject({ file: "f-chat", status: "done" });
    expect(await archive(w, [], dayLater)()).toEqual({ listed: 0, file: null });
    expect(w.log.filter((l) => l.startsWith("DL https://zoom.us/rec/video"))).toEqual([
      `DL https://zoom.us/rec/video 0-${CHUNK_BYTES - 1}`,
      `DL https://zoom.us/rec/video ${CHUNK_BYTES}-${CHUNK_BYTES * 2 - 1}`,
      `DL https://zoom.us/rec/video ${CHUNK_BYTES * 2}-${CHUNK_BYTES * 2 + 999}`,
    ]);
    expect(w.log).toContain("GET /meetings/s%2F1%3D%3D/recordings");
    expect(isArchived(["s/1=="], await store().filesForBookings(["b1"]))).toBe(true);
    expect(w.log.some((l) => l.startsWith("TRASH"))).toBe(false);
  });

  it("a session with files Zoom still processes is listed again until they are ready", async () => {
    fake.docs.set("settings/zoom", { autoDeleteRecordings: true, version: 1 });
    const zoomFiles = [
      {
        id: "f-chat",
        recording_type: "chat_file",
        file_extension: "txt",
        file_size: 10,
        download_url: "https://zoom.us/rec/chat",
        status: "completed",
      },
      {
        id: "f-vtt",
        recording_type: "audio_transcript",
        file_extension: "vtt",
        file_size: 5,
        download_url: "https://zoom.us/rec/vtt",
        status: "processing",
      },
    ];
    const w = world({ zoomFiles });
    expect(await archive(w)()).toMatchObject({ listed: 1, file: "f-chat", status: "done" });
    expect(await store().unlistedSessions(5)).toHaveLength(1);
    expect(w.log.some((l) => l.startsWith("TRASH"))).toBe(false);
    zoomFiles[1] = { ...zoomFiles[1], status: "completed" } as (typeof zoomFiles)[number];
    expect(await archive(w)()).toMatchObject({ listed: 1, file: "f-vtt", status: "done" });
    expect((await store().filesForBookings(["b1"])).map((f) => f.id).sort()).toEqual([
      "f-chat",
      "f-vtt",
    ]);
    expect(await store().unlistedSessions(5)).toEqual([]);
  });

  it("a session stored without createdAt (older imports) counts as past the late-file window", async () => {
    const id = Buffer.from("s/1==").toString("hex");
    const stored = { ...(fake.docs.get(`recordingSessions/${id}`) as Record<string, unknown>) };
    delete stored["createdAt"];
    fake.docs.set(`recordingSessions/${id}`, stored);
    expect((await store().unlistedSessions(5))[0]?.createdAt).toEqual(new Date(0));
    await archive(world())();
    expect(await store().unlistedSessions(5)).toEqual([]);
  });

  it("same name and size = done; a different size is a clash, reported and never overwritten", async () => {
    const errors: string[] = [];
    const w = world({
      driveHas: {
        "Rapat kerja 1 - shared screen with speaker view.mp4": 1,
        "Rapat kerja 1 - chat file.txt": 10,
      },
    });
    expect(await archive(w, errors)()).toMatchObject({ status: "clash" });
    expect(await archive(w, errors)()).toMatchObject({ status: "done" });
    expect(errors).toEqual(["recording archive clash"]);
    expect(w.received.size).toBe(0);
    expect(isArchived(["s/1=="], await store().filesForBookings(["b1"]))).toBe(false);
  });

  it("with auto-delete on, a session goes to the Zoom trash once all its files are in Drive", async () => {
    fake.docs.set("settings/zoom", { autoDeleteRecordings: true, version: 1 });
    const w = world({
      zoomFiles: [
        {
          id: "f-chat",
          recording_type: "chat_file",
          file_extension: "txt",
          file_size: 10,
          download_url: "https://zoom.us/rec/chat",
        },
        { id: "f-a", file_size: 4, download_url: "https://zoom.us/rec/a" },
      ],
    });
    expect(await archive(w)()).toMatchObject({ trashed: false });
    expect(await archive(w)()).toMatchObject({ trashed: true });
    expect(w.log.filter((l) => l.startsWith("TRASH"))).toEqual(["TRASH s%2F1%3D%3D"]);
    expect(await store().sessionTrashed("s/1==")).toBe(true);
    const file = (await store().filesForBookings(["b1"]))[0] as RecordingFile;
    await store().saveFile({ ...file, status: "pending" });
    expect(await archive(w)()).toMatchObject({ trashed: false });
  });

  it("failures count attempts and stop after the limit; a vanished file fails at once", async () => {
    const errors: string[] = [];
    const w = world({ failDownload: true });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await archive(w, errors)()).toMatchObject({ status: "pending" });
    }
    expect(await archive(w, errors)()).toMatchObject({ status: "failed" });
    expect(errors).toHaveLength(MAX_ATTEMPTS);
    const gone = world({ zoomFiles: [] });
    const chat = (await store().filesForBookings(["b1"])).find(
      (f) => f.id === "f-chat",
    ) as RecordingFile;
    expect(chat.status).toBe("pending");
    expect(await archive(gone)()).toMatchObject({ file: "f-chat", status: "failed" });
  });

  it("a session Zoom lists no files for is listed empty; re-listing keeps known files", async () => {
    expect(await archive(world({ zoomFiles: null }))()).toEqual({ listed: 1, file: null });
    const file = {
      id: "f1",
      bookingId: "b1",
      sessionUuid: "s/1==",
      status: "done",
    } as unknown as RecordingFile;
    await store().listSession("s/1==", [file], clock);
    await store().listSession("s/1==", [{ ...file, status: "pending" }], clock);
    expect((await store().filesForBookings(["b1"]))[0]?.status).toBe("done");
    expect(await store().filesForBookings([])).toEqual([]);
  });

  it("a session whose recordings are gone is listed empty; other errors do not stop the run", async () => {
    const errors: string[] = [];
    const gone = world({ listError: new ZoomApiError(404, "not found") });
    expect(await archive(gone, errors)()).toEqual({ listed: 1, file: null });
    expect(errors).toEqual(["recording listing failed"]);
    expect(await archive(gone, errors)()).toEqual({ listed: 0, file: null });

    await store().addSession("s/2==", "b1", clock);
    const down = world({ listError: new ZoomApiError(500, "down") });
    expect(await archive(down, errors)()).toEqual({ listed: 1, file: null });
    expect(await archive(down, errors)()).toEqual({ listed: 1, file: null });
  });

  it("a session of a booking that no longer exists is skipped", async () => {
    await store().addSession("orphan", "ghost", clock);
    fake.docs.delete("zoomRequests/b1");
    expect(await archive(world())()).toMatchObject({ listed: 2, file: null });
  });
});

describe("Google Drive client (F3)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("signs the JWT, finds or makes the folder, uploads in chunks and reports errors", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [];
    const answers: Array<() => Response> = [
      () => Response.json({ access_token: "tok", expires_in: 3600 }),
      () => Response.json({ files: [] }),
      () => Response.json({ id: "new-folder" }),
      () => Response.json({ files: [{ id: "f1", size: "42" }] }),
      () => new Response(null, { status: 200, headers: { location: "https://upload/session1" } }),
      () => new Response(null, { status: 308, headers: { range: "bytes=0-9" } }),
      () => new Response(null, { status: 308 }),
      () => Response.json({ id: "drive-file" }, { status: 201 }),
      () => Response.json({ files: [{ id: "existing" }] }),
      () => new Response(null, { status: 200 }),
      () => Response.json({ error: { message: "Insufficient permissions" } }, { status: 403 }),
      () => new Response("oops", { status: 500 }),
    ];
    const drive = createDriveClient(
      {
        clientEmail: "sa@project.iam.gserviceaccount.com",
        privateKey: pem,
        impersonate: "archive@ppiasiania.id",
        folderId: "root'1",
      },
      ((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          headers: init.headers as Record<string, string>,
          body: init.body,
        });
        return Promise.resolve((answers.shift() as () => Response)());
      }) as unknown as typeof fetch,
      () => 0,
    );
    expect(await drive.folder("[2026-11-11] Rapat's")).toBe("new-folder");
    expect(await drive.file("a.mp4", "folder")).toEqual({ id: "f1", size: 42 });
    expect(await drive.startUpload("a.mp4", "folder", 30)).toBe("https://upload/session1");
    expect(await drive.putChunk("https://upload/session1", new Uint8Array(10), 0, 30)).toEqual({
      done: false,
      uploaded: 10,
    });
    expect(await drive.putChunk("https://upload/session1", new Uint8Array(10), 10, 30)).toEqual({
      done: false,
      uploaded: 0,
    });
    expect(await drive.putChunk("https://upload/session1", new Uint8Array(10), 20, 30)).toEqual({
      done: true,
      fileId: "drive-file",
    });
    expect(await drive.folder("again")).toBe("existing");
    await expect(drive.startUpload("b", "folder", 1)).rejects.toThrow("no upload session");
    await expect(drive.file("c", "folder")).rejects.toThrow("drive_403: Insufficient permissions");
    await expect(drive.file("d", "folder")).rejects.toBeInstanceOf(DriveApiError);

    const assertion = new URLSearchParams(String(calls[0]?.body)).get("assertion") as string;
    const [header, claims, signature] = assertion.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "sa@project.iam.gserviceaccount.com",
      sub: "archive@ppiasiania.id",
      scope: "https://www.googleapis.com/auth/drive",
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${claims}`)
        .verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
    expect(new URL(calls[1]?.url ?? "").searchParams.get("q")).toContain(
      "name = '[2026-11-11] Rapat\\'s' and 'root\\'1' in parents",
    );
    expect(calls[6]?.headers["Content-Range"]).toBe("bytes 10-19/30");
    expect(calls.filter((c) => c.url.startsWith("https://oauth2"))).toHaveLength(1);
  });
});
