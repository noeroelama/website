import "server-only";
import type { SqlZoomStore } from "@website/db/sql";
import {
  archiveNames,
  CHUNK_BYTES,
  zoomUuidPath,
  type RecordingFile,
  type ZoomSettings,
} from "@website/domain/zoom";
import type { DriveClient } from "./drive";
import type { ZoomClient } from "./zoom-client";

interface ZoomRecordingList {
  recording_files?: Array<{
    id?: string;
    recording_type?: string;
    file_extension?: string;
    file_size: number;
    download_url?: string;
    status?: string;
  }>;
}

export interface RecordingArchiveDeps {
  readonly zoom: Pick<
    SqlZoomStore,
    | "get"
    | "unlistedSessions"
    | "listSession"
    | "nextFile"
    | "saveFile"
    | "filesForBookings"
    | "markSessionTrashed"
    | "sessionTrashed"
    | "readSettings"
  >;
  /** null = Zoom or Drive not set up: the job does nothing. */
  readonly client: Pick<ZoomClient, "get" | "download" | "trashRecording"> | null;
  readonly drive: Pick<DriveClient, "folder" | "file" | "startUpload" | "putChunk"> | null;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

/** After this many failed calls a file stops being retried (shown as failed). */
export const MAX_ATTEMPTS = 5;

/**
 * cron "recording-archive" (F3): lists up to 3 new sessions, then moves ONE chunk of ONE file
 * from Zoom to Drive and stores the progress, so every call stays short on shared hosting.
 */
export function createRecordingArchive(deps: RecordingArchiveDeps) {
  async function listSessions(): Promise<number> {
    const client = deps.client as NonNullable<RecordingArchiveDeps["client"]>;
    const sessions = await deps.zoom.unlistedSessions(3);
    for (const session of sessions) {
      const booking = await deps.zoom.get(session.bookingId);
      if (!booking) continue;
      const list = await client.get<ZoomRecordingList>(
        `/meetings/${zoomUuidPath(session.uuid)}/recordings`,
      );
      const now = deps.now();
      const files: RecordingFile[] = (list.recording_files ?? [])
        .filter((f) => f.id && f.download_url && f.status !== "processing")
        .map((f) => {
          const file = {
            recordingType: f.recording_type ?? "recording",
            extension: (f.file_extension ?? "bin").toLowerCase(),
          };
          return {
            id: f.id as string,
            bookingId: booking.id,
            sessionUuid: session.uuid,
            ...file,
            // Zoom gives the size of every completed file.
            size: f.file_size,
            ...archiveNames(booking, file),
            status: "pending",
            sessionUrl: null,
            uploaded: 0,
            driveFileId: null,
            attempts: 0,
            error: null,
            updatedAt: now,
          };
        });
      await deps.zoom.listSession(session.uuid, files, now);
    }
    return sessions.length;
  }

  /** The download URL is listed again each time (Zoom's URLs are not kept). */
  async function downloadUrl(file: RecordingFile): Promise<string | null> {
    const client = deps.client as NonNullable<RecordingArchiveDeps["client"]>;
    const list = await client.get<ZoomRecordingList>(
      `/meetings/${zoomUuidPath(file.sessionUuid)}/recordings`,
    );
    return list.recording_files?.find((f) => f.id === file.id)?.download_url ?? null;
  }

  async function step(file: RecordingFile): Promise<RecordingFile> {
    const client = deps.client as NonNullable<RecordingArchiveDeps["client"]>;
    const drive = deps.drive as NonNullable<RecordingArchiveDeps["drive"]>;
    const now = deps.now();
    let next = file;
    if (!file.sessionUrl) {
      const folderId = await drive.folder(file.folderName);
      const existing = await drive.file(file.fileName, folderId);
      if (existing) {
        // Same name and size = already archived; a different size is a clash, never overwritten.
        if (existing.size !== file.size) {
          deps.logError("recording archive clash", { fileId: file.id, name: file.fileName });
        }
        return existing.size === file.size
          ? { ...file, status: "done", driveFileId: existing.id, updatedAt: now }
          : {
              ...file,
              status: "clash",
              error: `A different file (${existing.size} bytes) has this name in Drive.`,
              updatedAt: now,
            };
      }
      next = {
        ...file,
        status: "uploading",
        sessionUrl: await drive.startUpload(file.fileName, folderId, file.size),
        uploaded: 0,
      };
    }
    const url = await downloadUrl(next);
    if (!url)
      return {
        ...next,
        status: "failed",
        error: "Zoom no longer lists this file.",
        updatedAt: now,
      };
    const end = Math.min(next.uploaded + CHUNK_BYTES, next.size) - 1;
    const response = await client.download(url, { start: next.uploaded, end });
    const chunk = new Uint8Array(await response.arrayBuffer());
    const sent = await drive.putChunk(next.sessionUrl as string, chunk, next.uploaded, next.size);
    return sent.done
      ? {
          ...next,
          status: "done",
          sessionUrl: null,
          uploaded: next.size,
          driveFileId: sent.fileId,
          error: null,
          updatedAt: now,
        }
      : { ...next, uploaded: sent.uploaded, error: null, updatedAt: now };
  }

  /** With the switch on: a session whose files are all in Drive goes to the Zoom trash. */
  async function trashIfDone(file: RecordingFile, settings: ZoomSettings): Promise<boolean> {
    if (!settings.autoDeleteRecordings || file.status !== "done") return false;
    if (await deps.zoom.sessionTrashed(file.sessionUuid)) return false;
    const files = (await deps.zoom.filesForBookings([file.bookingId])).filter(
      (f) => f.sessionUuid === file.sessionUuid,
    );
    if (!files.every((f) => f.status === "done")) return false;
    const client = deps.client as NonNullable<RecordingArchiveDeps["client"]>;
    await client.trashRecording(zoomUuidPath(file.sessionUuid));
    await deps.zoom.markSessionTrashed(file.sessionUuid, deps.now());
    return true;
  }

  return async function run(): Promise<Record<string, unknown>> {
    if (!deps.client || !deps.drive) return { configured: false };
    const listed = await listSessions();
    const file = await deps.zoom.nextFile();
    if (!file) return { listed, file: null };
    let next: RecordingFile;
    try {
      next = await step(file);
    } catch (error) {
      const attempts = file.attempts + 1;
      deps.logError("recording archive failed", { fileId: file.id, error: String(error) });
      next = {
        ...file,
        attempts,
        status: attempts >= MAX_ATTEMPTS ? "failed" : file.status,
        error: String(error).slice(0, 300),
        updatedAt: deps.now(),
      };
    }
    await deps.zoom.saveFile(next);
    const trashed = await trashIfDone(next, (await deps.zoom.readSettings()).settings);
    return { listed, file: next.id, status: next.status, uploaded: next.uploaded, trashed };
  };
}
