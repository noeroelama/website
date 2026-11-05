import "server-only";
import { createHmac } from "node:crypto";
import type { SqlZoomStore } from "@website/db/sql";
import { messageTo, type Contact, type Messenger } from "@website/domain/messaging";
import { zoomEventMeeting, type ZoomRequest } from "@website/domain/zoom";
import { readBodyLimited, verifyHmacSignature } from "@website/security";
import { systemZoomAudit } from "./zoom";
import type { ZoomClient } from "./zoom-client";

const MAX_BODY = 256 * 1024;

export interface ZoomWebhookDeps {
  /** ZOOM_WEBHOOK_SECRET_TOKEN; undefined = webhooks refused. */
  readonly secret: string | undefined;
  /** webhookEvents de-duplication: true the first time. */
  readonly record: (provider: string, eventId: string, now: Date) => Promise<boolean>;
  readonly zoom: Pick<SqlZoomStore, "findByZoomMeetingId" | "write">;
  readonly client: Pick<ZoomClient, "updateMeeting"> | null;
  readonly contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  readonly send: Messenger["send"];
  readonly adminUrl: string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const NOTICES: Record<string, readonly [string, string, string]> = {
  "recording.completed": [
    "recording",
    "Rekaman Zoom sudah tersedia.",
    "The Zoom recording is ready.",
  ],
  "meeting.summary_completed": [
    "summary",
    "Ringkasan AI Zoom sudah tersedia.",
    "The Zoom AI summary is ready.",
  ],
};

/**
 * POST /webhooks/zoom (F2). Order: body size → signature (`v0:{timestamp}:{body}`, 5-minute
 * tolerance) → URL validation challenge → de-duplication → only meetings that are OURS (a
 * booking with that Zoom meeting id) → work. Always a short generic answer; failures are logged.
 */
export function createZoomWebhookRoute(deps: ZoomWebhookDeps) {
  async function onEnded(booking: ZoomRequest, now: Date) {
    // Zoom also sends "ended" when the host leaves early; only close after the booked end.
    if (booking.closedAt || now.getTime() < booking.endsAt.getTime()) return;
    // The booking was found by this Zoom meeting id, so it is set.
    if (deps.client) {
      await deps.client.updateMeeting(booking.zoomMeetingId as string, {
        settings: { waiting_room: true, join_before_host: false },
      });
    }
    await deps.zoom.write(
      booking.id,
      booking.version,
      (current) => ({ ...(current as ZoomRequest), closedAt: now }),
      systemZoomAudit("zoom-webhook"),
      now,
    );
  }

  async function onRecording(booking: ZoomRequest, uuid: string | null, now: Date) {
    if (!uuid || booking.recordingUuids.includes(uuid)) return;
    await deps.zoom.write(
      booking.id,
      booking.version,
      (current) => {
        const latest = current as ZoomRequest;
        return { ...latest, recordingUuids: [...new Set([...latest.recordingUuids, uuid])] };
      },
      systemZoomAudit("zoom-webhook"),
      now,
    );
  }

  async function notify(booking: ZoomRequest, event: string, uuid: string | null) {
    const notice = NOTICES[event] as (typeof NOTICES)[string];
    const contacts = await deps.contacts([booking.requestedBy]);
    const text = `${notice[1]}\n\n${notice[2]}\n\n${booking.topic}\n${deps.adminUrl}/zoom`;
    await deps.send(
      messageTo(contacts.get(booking.requestedBy) ?? null, {
        subject: `Zoom: ${booking.topic}`,
        text,
        html: `<p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>")}</p>`,
      }),
      `zoom:${booking.id}:${notice[0]}:${(uuid ?? "").replace(/[^A-Za-z0-9_.@-]/g, "_") || "none"}`,
    );
  }

  return async (request: Request): Promise<Response> => {
    const bytes = await readBodyLimited(request, MAX_BODY);
    if (!bytes) return reply({ error: "too_large" }, 413);
    const body = new TextDecoder().decode(bytes);
    const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";
    const now = deps.now();
    if (
      !deps.secret ||
      !verifyHmacSignature({
        payload: `v0:${timestamp}:${body}`,
        signature: request.headers.get("x-zm-signature"),
        secret: deps.secret,
        prefix: "v0=",
        timestamp,
        now,
        toleranceSeconds: 300,
      })
    ) {
      return reply({ error: "unauthenticated" }, 401);
    }
    let event: { event?: unknown; event_ts?: unknown; payload?: unknown };
    try {
      event = JSON.parse(body) as typeof event;
    } catch {
      return reply({ error: "invalid_input" }, 400);
    }
    const name = typeof event.event === "string" ? event.event : "";
    if (name === "endpoint.url_validation") {
      const plainToken = (event.payload as { plainToken?: unknown } | undefined)?.plainToken;
      if (typeof plainToken !== "string") return reply({ error: "invalid_input" }, 400);
      return reply({
        plainToken,
        encryptedToken: createHmac("sha256", deps.secret).update(plainToken).digest("hex"),
      });
    }
    const meeting = zoomEventMeeting(event.payload);
    if (!meeting) return reply({ ok: true });
    const eventId = `${name}:${meeting.uuid ?? meeting.id}:${JSON.stringify(event.event_ts ?? null)}`;
    const id = createHmac("sha256", "zoom-event").update(eventId).digest("hex");
    if (!(await deps.record("zoom", id, now))) return reply({ ok: true });
    const booking = await deps.zoom.findByZoomMeetingId(meeting.id);
    if (!booking) return reply({ ok: true }); // not ours: ignored
    try {
      if (name === "meeting.ended") await onEnded(booking, now);
      if (name === "recording.completed") await onRecording(booking, meeting.uuid, now);
      if (Object.hasOwn(NOTICES, name)) await notify(booking, name, meeting.uuid);
    } catch (error) {
      deps.logError("zoom webhook failed", {
        event: name,
        bookingId: booking.id,
        error: String(error),
      });
    }
    return reply({ ok: true });
  };
}
