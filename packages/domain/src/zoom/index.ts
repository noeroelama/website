import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, wallTimeToUtc, type EntityMeta } from "../shared";

export * from "./recordings";

/**
 * Zoom bookings (F1), ported from PPIDK `Zoom/*`: a unit asks for a room on the organisation's
 * Zoom licences; capacity is counted per UTC day (`zoomCapacity/{yyyy-mm-dd}`) so two bookings
 * can never take the last slot at once; approval is optional (`settings/zoom`); the Zoom meeting
 * is created after the slot is held, and a cron job retries rooms that have no link yet.
 */

export const ZOOM_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ZoomStatus = (typeof ZOOM_STATUSES)[number];
export const ZOOM_STATUS_LABELS: Record<ZoomStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const JOIN_BEFORE_HOST_MINUTES = [0, 5, 10, 15] as const;

/** `settings/zoom` (operational, edited on the Zoom page; never a secret in clear). */
export interface ZoomSettings {
  readonly licences: number;
  readonly concurrentPerLicence: number;
  readonly approvalRequired: boolean;
  /** Hours between now and the start a request needs at least. */
  readonly minNoticeHours: number;
  /** Longest booking without `zoom.long_duration`. */
  readonly maxDurationMinutes: number;
  /** The Host Key, encrypted with FIELD_ENCRYPTION_KEY (encryptField); null = none. */
  readonly hostKeyEncrypted: string | null;
  /** F3: move a session's recording to the Zoom trash once every file is in Drive. */
  readonly autoDeleteRecordings: boolean;
}
export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  licences: 1,
  concurrentPerLicence: 1,
  approvalRequired: true,
  minNoticeHours: 24,
  maxDurationMinutes: 240,
  hostKeyEncrypted: null,
  autoDeleteRecordings: false,
};

export const ZoomSettingsInputSchema = z
  .object({
    licences: z.number().int().min(0).max(100),
    concurrentPerLicence: z.number().int().min(1).max(10),
    approvalRequired: z.boolean(),
    minNoticeHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 30),
    maxDurationMinutes: z
      .number()
      .int()
      .min(15)
      .max(24 * 60),
    autoDeleteRecordings: z.boolean().default(false),
  })
  .strict();

/** Longest any booking may be (with zoom.long_duration). */
export const ABSOLUTE_MAX_MINUTES = 24 * 60;

export const ZoomRequestInputSchema = z
  .object({
    topic: safeText(200).pipe(z.string().min(2, "Enter the topic.")),
    startsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose the start time."),
    timeZone: z
      .string()
      .max(64)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "Choose a time zone."),
    durationMinutes: z.number().int().min(15).max(ABSOLUTE_MAX_MINUTES),
    passcode: z.string().regex(/^[A-Za-z0-9@*_-]{1,10}$/, "1-10 letters, digits or @ * _ -."),
    joinBeforeHostMinutes: z.union(JOIN_BEFORE_HOST_MINUTES.map((m) => z.literal(m))),
    /** A meeting of the platform this room is for (optional). */
    meetingId: safeId.nullable().default(null),
  })
  .strict();
export type ZoomRequestInput = z.infer<typeof ZoomRequestInputSchema>;

export interface ZoomRequest extends EntityMeta {
  readonly topic: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly passcode: string;
  readonly joinBeforeHostMinutes: number;
  readonly meetingId: string | null;
  readonly requestedBy: string;
  /** The requester's unit (from their appointment); null = region. */
  readonly orgUnitId: string | null;
  readonly orgUnitPath: readonly string[];
  readonly status: ZoomStatus;
  readonly decidedBy: string | null;
  readonly decisionNote: string | null;
  /** Filled when the Zoom meeting exists (the cron job retries until then). */
  readonly zoomMeetingId: string | null;
  readonly joinUrl: string | null;
  readonly shortUrl: string | null;
  readonly roomError: string | null;
  /** Set when Zoom said the meeting ended after its end time (waiting room on, F2). */
  readonly closedAt: Date | null;
  /** Every recorded session (Zoom meeting UUID) of this room (F2, F3). */
  readonly recordingUuids: readonly string[];
}

/**
 * The meeting a Zoom webhook is about, from both payload shapes: recordings and meeting events
 * use `object.id` / `object.uuid`, AI summaries `object.meeting_id` / `object.meeting_uuid`.
 * Matching is by OUR meeting ids only (never by host e-mail: the host is shared).
 */
export function zoomEventMeeting(payload: unknown): { id: string; uuid: string | null } | null {
  const object = (payload as { object?: Record<string, unknown> } | null)?.object;
  const id = object?.["id"] ?? object?.["meeting_id"];
  const uuid = object?.["uuid"] ?? object?.["meeting_uuid"];
  if (typeof id !== "number" && typeof id !== "string") return null;
  return { id: String(id), uuid: typeof uuid === "string" ? uuid : null };
}

/** UTC start and end from the form; refuses the past, short notice and too long. */
export function requestTimes(
  input: Pick<ZoomRequestInput, "startsAtLocal" | "timeZone" | "durationMinutes">,
  settings: Pick<ZoomSettings, "minNoticeHours" | "maxDurationMinutes">,
  options: { now: Date; longDuration: boolean },
): { startsAt: Date; endsAt: Date } {
  // The schema already checked the wall-time format.
  const startsAt = wallTimeToUtc(input.startsAtLocal, input.timeZone) as Date;
  const lead = startsAt.getTime() - options.now.getTime();
  if (lead < 0) throw new RuleViolationError("The start time has passed.");
  if (lead < settings.minNoticeHours * 3_600_000) {
    throw new RuleViolationError(
      `Book at least ${settings.minNoticeHours} hours ahead (in ${input.timeZone} that is before ${new Intl.DateTimeFormat("en-GB", { timeZone: input.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAt.getTime() - settings.minNoticeHours * 3_600_000))}).`,
    );
  }
  if (!options.longDuration && input.durationMinutes > settings.maxDurationMinutes) {
    throw new RuleViolationError(
      `A booking may last at most ${settings.maxDurationMinutes} minutes.`,
    );
  }
  return { startsAt, endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000) };
}

/** Every UTC day an interval touches ("2026-11-10"), in order. */
export function utcDays(startsAt: Date, endsAt: Date): string[] {
  const days: string[] = [];
  const day = new Date(
    Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate()),
  );
  // The end is exclusive: a booking ending at 00:00 does not touch the next day.
  while (day.getTime() < endsAt.getTime()) {
    days.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

export interface HeldSlot {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Approved bookings overlapping the interval must stay below licences × concurrent. */
export function assertCapacity(
  held: readonly HeldSlot[],
  slot: HeldSlot,
  settings: Pick<ZoomSettings, "licences" | "concurrentPerLicence">,
): void {
  const capacity = settings.licences * settings.concurrentPerLicence;
  const overlapping = new Set(
    held
      .filter(
        (h) =>
          h.id !== slot.id &&
          h.startsAt.getTime() < slot.endsAt.getTime() &&
          slot.startsAt.getTime() < h.endsAt.getTime(),
      )
      .map((h) => h.id),
  );
  if (overlapping.size >= capacity) {
    throw new RuleViolationError("Every Zoom licence is booked at that time. Choose another time.");
  }
}

/** Approve / reject only a pending request; cancel only a pending or approved one. */
export function assertStatus(request: Pick<ZoomRequest, "status">, allowed: readonly ZoomStatus[]) {
  if (!allowed.includes(request.status)) {
    throw new RuleViolationError(
      `This booking is ${ZOOM_STATUS_LABELS[request.status].toLowerCase()}.`,
    );
  }
}

/** The text people forward, once the room exists. Never contains the Host Key. */
export function invitationText(
  request: Pick<
    ZoomRequest,
    | "topic"
    | "startsAt"
    | "endsAt"
    | "timeZone"
    | "passcode"
    | "zoomMeetingId"
    | "joinUrl"
    | "shortUrl"
  >,
): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: request.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const id = (request.zoomMeetingId as string).replace(/(\d{3})(\d{3,4})(\d{4})$/, "$1 $2 $3");
  return [
    `Topik / Topic: ${request.topic}`,
    `Waktu / Time: ${when.format(request.startsAt)} – ${new Intl.DateTimeFormat("en-GB", { timeZone: request.timeZone, timeStyle: "short" }).format(request.endsAt)} (${request.timeZone})`,
    "",
    `Join Zoom: ${request.shortUrl ?? request.joinUrl}`,
    `Meeting ID: ${id}`,
    `Passcode: ${request.passcode}`,
  ].join("\n");
}
