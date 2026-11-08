import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditEvent } from "@website/audit";
import type { SqlZoomStore, ZoomAudit } from "@website/db/sql";
import { RuleViolationError } from "@website/domain/shared";
import {
  assertStatus,
  requestTimes,
  ZoomRequestInputSchema,
  ZoomSettingsInputSchema,
  type ZoomRequest,
} from "@website/domain/zoom";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";
import { ZoomApiError, type ZoomClient } from "./zoom-client";

export interface ZoomDeps {
  readonly zoom: Pick<
    SqlZoomStore,
    "get" | "write" | "withoutRoom" | "readSettings" | "saveSettings"
  >;
  readonly client: Pick<ZoomClient, "createMeeting" | "deleteMeeting"> | null;
  readonly shorten: (longUrl: string, title: string) => Promise<string>;
  readonly unitOf: (
    uid: string,
  ) => Promise<{ orgUnitId: string; orgUnitPath: readonly string[] } | null>;
  readonly encrypt: ((plain: string) => string) | null;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();
const Decide = Ref.extend({ note: safeText(500, { allowEmpty: true }).default("") }).strict();
const Settings = ZoomSettingsInputSchema.extend({
  version: version.nullable(),
  hostKey: z
    .string()
    .regex(/^(\d{6})?$/, "The Host Key has 6 digits.")
    .nullable(),
}).strict();

const zoomAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE"): ZoomAudit =>
  (before, after, current, next) =>
    audit({
      module: "zoom",
      action,
      resourceType: "zoomRequest",
      resourceId: next.id,
      title: next.topic,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export const systemZoomAudit =
  (actor: string): ZoomAudit =>
  (before, after, current, next): AuditEvent => ({
    id: randomUUID(),
    occurredAt: next.updatedAt,
    actor: { type: "system", id: actor },
    action: "UPDATE",
    module: "zoom",
    title: next.topic,
    resourceType: "zoomRequest",
    resourceId: next.id,
    operationId: randomUUID(),
    before,
    after,
    versionBefore: (current as ZoomRequest).version,
    versionAfter: next.version,
    revertible: false,
    revertOf: null,
    request: { requestId: randomUUID() },
    prevHash: null,
    hash: null,
  });

export const canCancelZoom = (
  principal: Principal,
  request: Pick<ZoomRequest, "requestedBy" | "orgUnitPath">,
) =>
  request.requestedBy === principal.userId ||
  can(principal, "zoom.approve", { orgUnitPath: request.orgUnitPath });

export function createZoomActions(deps: ZoomDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.zoom.get(id))?.orgUnitPath ?? [],
  });

  async function ensureRoom(request: ZoomRequest, audit: ZoomAudit): Promise<ZoomRequest> {
    if (request.status !== "approved" || request.joinUrl || !deps.client) return request;
    let room: { id: string; joinUrl: string; shortUrl: string } | null = null;
    let roomError: string | null = null;
    try {
      const created = await deps.client.createMeeting({
        topic: request.topic,
        startsAt: request.startsAt,
        durationMinutes: Math.round(
          (request.endsAt.getTime() - request.startsAt.getTime()) / 60_000,
        ),
        timeZone: request.timeZone,
        passcode: request.passcode,
        joinBeforeHostMinutes: request.joinBeforeHostMinutes,
      });
      room = { ...created, shortUrl: await deps.shorten(created.joinUrl, request.topic) };
    } catch (error) {
      roomError = String(error).slice(0, 300);
      deps.logError("zoom room failed", { requestId: request.id, error: roomError });
      if (roomError === request.roomError) return request;
    }
    return deps.zoom.write(
      request.id,
      request.version,
      (current) => {
        const latest = current as ZoomRequest;
        return room && latest.status === "approved"
          ? {
              ...latest,
              zoomMeetingId: room.id,
              joinUrl: room.joinUrl,
              shortUrl: room.shortUrl,
              roomError: null,
            }
          : { ...latest, roomError: roomError ?? "Booking changed before the room was saved." };
      },
      audit,
      deps.now(),
    );
  }

  const request = createGuardedAction({
    permission: "zoom.edit",
    inSomeScope: true,
    input: ZoomRequestInputSchema,
    handler: async (input, principal, audit) => {
      const now = deps.now();
      const unit = await deps.unitOf(principal.userId);
      const orgUnitPath = unit?.orgUnitPath ?? [];
      if (!can(principal, "zoom.edit", { orgUnitPath })) {
        throw new RuleViolationError("You can only book Zoom for the unit of your appointment.");
      }
      const saved = await deps.zoom.write(
        null,
        null,
        (_current, settings) => {
          const times = requestTimes(input, settings, {
            now,
            longDuration: can(principal, "zoom.long_duration", { orgUnitPath }),
          });
          const status = settings.approvalRequired ? "pending" : "approved";
          return {
            topic: input.topic,
            ...times,
            timeZone: input.timeZone,
            passcode: input.passcode,
            joinBeforeHostMinutes: input.joinBeforeHostMinutes,
            meetingId: input.meetingId,
            requestedBy: principal.userId,
            orgUnitId: unit?.orgUnitId ?? null,
            orgUnitPath: [...orgUnitPath],
            status,
            decidedBy: status === "approved" ? principal.userId : null,
            decisionNote: null,
            zoomMeetingId: null,
            joinUrl: null,
            shortUrl: null,
            roomError: null,
            closedAt: null,
            recordingUuids: [],
            deletedAt: null,
          };
        },
        zoomAudit(audit, "CREATE"),
        now,
      );
      const roomed = await ensureRoom(saved, zoomAudit(audit, "UPDATE"));
      return { id: roomed.id, status: roomed.status, joinUrl: roomed.joinUrl };
    },
  });

  const decide = (approve: boolean) =>
    createGuardedAction({
      permission: "zoom.approve",
      input: Decide,
      resource: scopeOf,
      handler: async ({ id, version: v, note }, principal, audit) => {
        const now = deps.now();
        const saved = await deps.zoom.write(
          id,
          v,
          (current) => {
            const booking = current as ZoomRequest;
            assertStatus(booking, ["pending"]);
            if (approve && booking.startsAt.getTime() < now.getTime()) {
              throw new RuleViolationError("The start time has passed.");
            }
            return {
              ...booking,
              status: approve ? "approved" : "rejected",
              decidedBy: principal.userId,
              decisionNote: note || null,
            };
          },
          zoomAudit(audit, "UPDATE"),
          now,
        );
        const roomed = await ensureRoom(saved, zoomAudit(audit, "UPDATE"));
        return { version: roomed.version, status: roomed.status };
      },
    });

  const cancel = createGuardedAction({
    permission: "zoom.read",
    inSomeScope: true,
    input: Ref,
    handler: async ({ id, version: v }, principal, audit) => {
      const saved = await deps.zoom.write(
        id,
        v,
        (current) => {
          const booking = current as ZoomRequest;
          if (!canCancelZoom(principal, booking)) {
            throw new RuleViolationError(
              "Only the requester or an approver can cancel this booking.",
            );
          }
          assertStatus(booking, ["pending", "approved"]);
          return { ...booking, status: "cancelled" };
        },
        zoomAudit(audit, "UPDATE"),
        deps.now(),
      );
      if (saved.zoomMeetingId && deps.client) {
        await deps.client
          .deleteMeeting(saved.zoomMeetingId)
          .catch((error: unknown) =>
            deps.logError("zoom delete failed", { requestId: id, error: String(error) }),
          );
      }
      return { version: saved.version };
    },
  });

  const saveSettings = createGuardedAction({
    permission: "zoom.settings",
    input: Settings,
    handler: async ({ version: v, hostKey, ...settings }, _principal, audit) => {
      const current = (await deps.zoom.readSettings()).settings;
      let hostKeyEncrypted = current.hostKeyEncrypted;
      if (hostKey === "") hostKeyEncrypted = null;
      else if (hostKey !== null) {
        if (!deps.encrypt)
          throw new RuleViolationError(
            "FIELD_ENCRYPTION_KEY is not set; the Host Key cannot be stored.",
          );
        hostKeyEncrypted = deps.encrypt(hostKey);
      }
      const saved = await deps.zoom.saveSettings(
        { ...settings, hostKeyEncrypted },
        v,
        (before, after, next) =>
          audit({
            module: "zoom",
            action: "UPDATE",
            resourceType: "settings",
            resourceId: "zoom",
            title: "Zoom settings",
            before,
            after,
            versionBefore: v,
            versionAfter: next,
            revertible: false,
          }),
      );
      return { version: saved };
    },
  });

  async function retryRooms(): Promise<{ tried: number; created: number }> {
    const waiting = await deps.zoom.withoutRoom(10);
    let created = 0;
    for (const booking of waiting) {
      if ((await ensureRoom(booking, systemZoomAudit("zoom-rooms"))).joinUrl) created += 1;
    }
    return { tried: waiting.length, created };
  }

  return {
    request,
    approve: decide(true),
    reject: decide(false),
    cancel,
    saveSettings,
    retryRooms,
  };
}

export function createZoomTranscript(deps: {
  readonly booking: (id: string) => Promise<Pick<ZoomRequest, "zoomMeetingId"> | null>;
  readonly client: Pick<ZoomClient, "get" | "download"> | null;
}) {
  return async (meeting: { room: { zoomRequestId: string | null } }): Promise<string | null> => {
    const id = meeting.room.zoomRequestId;
    const zoomMeetingId = id ? (await deps.booking(id))?.zoomMeetingId : null;
    if (!zoomMeetingId || !deps.client) return null;
    try {
      const recordings = await deps.client.get<{
        recording_files?: Array<{ file_type?: string; download_url?: string }>;
      }>(`/meetings/${encodeURIComponent(zoomMeetingId)}/recordings`);
      const file = recordings.recording_files?.find((f) => f.file_type === "TRANSCRIPT");
      return file?.download_url
        ? await (await deps.client.download(file.download_url)).text()
        : null;
    } catch (error) {
      if (error instanceof ZoomApiError && error.status === 404) return null;
      throw error;
    }
  };
}
