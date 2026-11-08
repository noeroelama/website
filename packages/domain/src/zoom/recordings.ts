export const RECORDING_FILE_STATUSES = ["pending", "uploading", "done", "clash", "failed"] as const;
export type RecordingFileStatus = (typeof RECORDING_FILE_STATUSES)[number];

export interface RecordingFile {
  readonly id: string;
  readonly bookingId: string;
  readonly sessionUuid: string;
  readonly recordingType: string;
  readonly extension: string;
  readonly size: number;
  readonly folderName: string;
  readonly fileName: string;
  readonly status: RecordingFileStatus;
  readonly sessionUrl: string | null;
  readonly uploaded: number;
  readonly driveFileId: string | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly updatedAt: Date;
}

const clean = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

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

export const zoomUuidPath = (uuid: string) =>
  uuid.startsWith("/") || uuid.includes("//")
    ? encodeURIComponent(encodeURIComponent(uuid))
    : encodeURIComponent(uuid);

export const CHUNK_BYTES = 8 * 1024 * 1024;

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
