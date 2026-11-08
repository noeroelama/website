import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, wallTimeToUtc, type EntityMeta } from "../shared";

export * from "./recordings";

export const ZOOM_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ZoomStatus = (typeof ZOOM_STATUSES)[number];
export const ZOOM_STATUS_LABELS: Record<ZoomStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const JOIN_BEFORE_HOST_MINUTES = [0, 5, 10, 15] as const;

export interface ZoomSettings {
  readonly licences: number;
  readonly concurrentPerLicence: number;
  readonly approvalRequired: boolean;
  readonly minNoticeHours: number;
  readonly maxDurationMinutes: number;
  readonly hostKeyEncrypted: string | null;
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
  readonly orgUnitId: string | null;
  readonly orgUnitPath: readonly string[];
  readonly status: ZoomStatus;
  readonly decidedBy: string | null;
  readonly decisionNote: string | null;
  readonly zoomMeetingId: string | null;
  readonly joinUrl: string | null;
  readonly shortUrl: string | null;
  readonly roomError: string | null;
  readonly closedAt: Date | null;
  readonly recordingUuids: readonly string[];
}

export function zoomEventMeeting(payload: unknown): { id: string; uuid: string | null } | null {
  const object = (payload as { object?: Record<string, unknown> } | null)?.object;
  const id = object?.["id"] ?? object?.["meeting_id"];
  const uuid = object?.["uuid"] ?? object?.["meeting_uuid"];
  if (typeof id !== "number" && typeof id !== "string") return null;
  return { id: String(id), uuid: typeof uuid === "string" ? uuid : null };
}

export function requestTimes(
  input: Pick<ZoomRequestInput, "startsAtLocal" | "timeZone" | "durationMinutes">,
  settings: Pick<ZoomSettings, "minNoticeHours" | "maxDurationMinutes">,
  options: { now: Date; longDuration: boolean },
): { startsAt: Date; endsAt: Date } {
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

export function utcDays(startsAt: Date, endsAt: Date): string[] {
  const days: string[] = [];
  const day = new Date(
    Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate()),
  );
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

export function assertStatus(request: Pick<ZoomRequest, "status">, allowed: readonly ZoomStatus[]) {
  if (!allowed.includes(request.status)) {
    throw new RuleViolationError(
      `This booking is ${ZOOM_STATUS_LABELS[request.status].toLowerCase()}.`,
    );
  }
}

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
