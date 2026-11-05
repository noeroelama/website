/**
 * Recording archive (F3), ported from PPIDK `Drive/*`: every file of every recorded session of a
 * booking is copied from Zoom to Google Drive as "[YYYY-MM-DD] Topic/Topic - type.ext", one file
 * (or one resumable chunk) per cron call. A file of the same name but a different size already in
 * Drive is a CLASH: recorded, never overwritten, never skipped silently.
 */

export const RECORDING_FILE_STATUSES = ["pending", "uploading", "done", "clash", "failed"] as const;
export type RecordingFileStatus = (typeof RECORDING_FILE_STATUSES)[number];

export interface RecordingFile {
  /** Zoom's recording file id. */
  readonly id: string;
  readonly bookingId: string;
  readonly sessionUuid: string;
  /** Zoom's recording_type, e.g. "shared_screen_with_speaker_view", "audio_only", "chat_file". */
  readonly recordingType: string;
  /** Zoom's file_extension in lower case, e.g. "mp4", "m4a", "vtt", "txt". */
  readonly extension: string;
  readonly size: number;
  readonly folderName: string;
  readonly fileName: string;
  readonly status: RecordingFileStatus;
  /** Drive resumable session URL while uploading. */
  readonly sessionUrl: string | null;
  /** Bytes Drive has confirmed. */
  readonly uploaded: number;
  readonly driveFileId: string | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly updatedAt: Date;
}

/** Characters Drive and the desktop sync clients dislike in names. */
const clean = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

/** "[2026-11-10] Rapat kerja" and "Rapat kerja - shared screen with speaker view.mp4". */
export function archiveNames(
  booking: { topic: string; startsAt: Date; timeZone: string },
  file: { recordingType: string; extension: string },
): { folderName: string; fileName: string } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: booking.timeZone }).format(
    booking.startsAt,
  );
  const topic = clean(booking.topic) || "Zoom";
  const type = clean(file.recordingType.replace(/_/g, " ").toLowerCase()) || "recording";
  return {
    folderName: `[${day}] ${topic}`,
    fileName: `${topic} - ${type}.${clean(file.extension.toLowerCase())}`,
  };
}

/** Zoom wants a session UUID that starts with "/" or contains "//" encoded twice. */
export const zoomUuidPath = (uuid: string) =>
  uuid.startsWith("/") || uuid.includes("//")
    ? encodeURIComponent(encodeURIComponent(uuid))
    : encodeURIComponent(uuid);

/** Upload chunk: a multiple of 256 KiB (Drive's rule), small enough for one shared-hosting request. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Read-time "archived": every file of every recorded session is in Drive. A clash or a failure
 * keeps it false (someone must look); sessions not listed yet keep it false too.
 */
export function isArchived(
  sessions: readonly string[],
  files: ReadonlyArray<Pick<RecordingFile, "sessionUuid" | "status">>,
): boolean {
  if (sessions.length === 0) return false;
  return sessions.every((uuid) => {
    const mine = files.filter((f) => f.sessionUuid === uuid);
    return mine.length > 0 && mine.every((f) => f.status === "done");
  });
}
