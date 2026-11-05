import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqlWebhookEventStore, createSqlZoomStore } from "@website/db/sql";
import type { ZoomRequest } from "@website/domain/zoom";
import { createZoomTranscript } from "../../apps/admin/src/server/zoom";
import { ZoomApiError } from "../../apps/admin/src/server/zoom-client";
import { createZoomWebhookRoute } from "../../apps/admin/src/server/zoom-webhook";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlZoomStore>[0];
const SECRET = "zoom-secret-token";
let clock = new Date("2026-11-10T12:00:00Z");
let fake: ReturnType<typeof fakeDb>;
let updates: Array<{ id: string; patch: unknown }>;
let sent: string[];
let errors: string[];

const booking = {
  topic: 'Rapat "kerja" & co',
  startsAt: new Date("2026-11-10T10:00:00Z"),
  endsAt: new Date("2026-11-10T11:30:00Z"),
  timeZone: "Asia/Tokyo",
  passcode: "ppi",
  joinBeforeHostMinutes: 0,
  meetingId: null,
  requestedBy: "req",
  orgUnitId: null,
  orgUnitPath: [],
  status: "approved",
  decidedBy: "boss",
  decisionNote: null,
  zoomMeetingId: "81234567890",
  joinUrl: "https://zoom.us/j/81234567890",
  shortUrl: null,
  roomError: null,
  closedAt: null,
  recordingUuids: [],
  version: 2,
  createdAt: clock,
  updatedAt: clock,
  deletedAt: null,
};

const route = (secret = SECRET, failUpdate = false, withClient = true) =>
  createZoomWebhookRoute({
    secret: secret || undefined,
    record: (provider, id, now) =>
      createSqlWebhookEventStore(fake.db as unknown as Db).record(provider, id, now),
    zoom: createSqlZoomStore(fake.db as unknown as Db),
    client: withClient
      ? {
          updateMeeting: (id, patch) => {
            if (failUpdate) return Promise.reject(new Error("zoom down"));
            updates.push({ id, patch });
            return Promise.resolve();
          },
        }
      : null,
    // The requester has no contact on record: the message is still logged (as skipped).
    contacts: () => Promise.resolve(new Map()),
    send: (_message, key) => {
      sent.push(key);
      return Promise.resolve("logged");
    },
    adminUrl: "https://admin.example.org",
    logError: (message) => errors.push(message),
    now: () => clock,
  });

function signed(body: unknown, options: { secret?: string; ts?: number } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(options.ts ?? Math.floor(clock.getTime() / 1000));
  const signature = `v0=${createHmac("sha256", options.secret ?? SECRET)
    .update(`v0:${ts}:${text}`)
    .digest("hex")}`;
  return new Request("https://admin.example.org/webhooks/zoom", {
    method: "POST",
    headers: {
      "x-zm-request-timestamp": ts,
      "x-zm-signature": signature,
      "content-type": "application/json",
    },
    body: text,
  });
}
const event = (name: string, object: Record<string, unknown>, ts = 1) => ({
  event: name,
  event_ts: ts,
  payload: { account_id: "acc", object },
});
const stored = async () =>
  (await createSqlZoomStore(fake.db as unknown as Db).get("b1")) as ZoomRequest;

beforeEach(() => {
  fake = fakeDb();
  updates = [];
  sent = [];
  errors = [];
  clock = new Date("2026-11-10T12:00:00Z");
  fake.docs.set("zoomRequests/b1", { ...booking });
});

describe("Zoom webhooks (F2)", () => {
  it("refuses forged, old or unsigned requests, and everything without a secret", async () => {
    const body = event("meeting.ended", { id: 81234567890, uuid: "u1" });
    expect((await route()(signed(body, { secret: "wrong" }))).status).toBe(401);
    expect(
      (await route()(signed(body, { ts: Math.floor(clock.getTime() / 1000) - 600 }))).status,
    ).toBe(401);
    expect((await route("")(signed(body))).status).toBe(401);
    const big = new Request("https://admin.example.org/webhooks/zoom", {
      method: "POST",
      headers: { "content-length": String(300 * 1024) },
      body: "x",
    });
    expect((await route()(big)).status).toBe(413);
    expect((await route()(signed("not json"))).status).toBe(400);
    const unsigned = new Request("https://admin.example.org/webhooks/zoom", {
      method: "POST",
      body: "{}",
    });
    expect((await route()(unsigned)).status).toBe(401);
    expect((await route()(signed({ payload: {} }))).status).toBe(200);
    expect(updates).toEqual([]);
  });

  it("answers the URL validation challenge", async () => {
    const response = await route()(
      signed({ event: "endpoint.url_validation", payload: { plainToken: "abc" } }),
    );
    expect(await response.json()).toEqual({
      plainToken: "abc",
      encryptedToken: createHmac("sha256", SECRET).update("abc").digest("hex"),
    });
    expect((await route()(signed({ event: "endpoint.url_validation", payload: {} }))).status).toBe(
      400,
    );
  });

  it("meeting.ended after the booked end closes the room once; earlier or foreign is ignored", async () => {
    clock = new Date("2026-11-10T11:00:00Z");
    await route()(signed(event("meeting.ended", { id: 81234567890, uuid: "u0" }, 1)));
    expect(updates).toEqual([]);
    clock = new Date("2026-11-10T12:00:00Z");
    expect(
      (await route()(signed(event("meeting.ended", { id: 81234567890, uuid: "u1" }, 2)))).status,
    ).toBe(200);
    expect(updates).toEqual([
      { id: "81234567890", patch: { settings: { waiting_room: true, join_before_host: false } } },
    ]);
    expect((await stored()).closedAt).toEqual(clock);
    // A replay (same event) and a second "ended" change nothing.
    await route()(signed(event("meeting.ended", { id: 81234567890, uuid: "u1" }, 2)));
    await route()(signed(event("meeting.ended", { id: 81234567890, uuid: "u2" }, 3)));
    expect(updates).toHaveLength(1);
    await route()(signed(event("meeting.ended", { id: 99999, uuid: "x" }, 4)));
    await route()(signed(event("meeting.ended", { topic: "no id" }, 5)));
    expect(updates).toHaveLength(1);
    fake.docs.set("zoomRequests/b2", { ...booking, zoomMeetingId: "222", recordingUuids: [] });
    await route(
      SECRET,
      false,
      false,
    )(signed({ event: "meeting.ended", payload: { object: { id: 222 } } }));
    expect(updates).toHaveLength(1);
    expect(fake.docs.get("zoomRequests/b2")).toMatchObject({
      closedAt: expect.anything() as unknown,
    });
  });

  it("recording and summary: both payload shapes, the requester told once per session", async () => {
    await route()(signed(event("recording.completed", { id: 81234567890, uuid: "sess/1==" })));
    await route()(signed(event("recording.completed", { id: 81234567890, uuid: "sess/1==" }, 2)));
    await route()(signed(event("recording.completed", { id: "81234567890", uuid: "sess2" }, 3)));
    await route()(signed(event("recording.completed", { id: "81234567890" }, 4)));
    await route()(
      signed(
        event("meeting.summary_completed", { meeting_id: 81234567890, meeting_uuid: "sess2" }),
      ),
    );
    expect((await stored()).recordingUuids).toEqual(["sess/1==", "sess2"]);
    expect(sent).toEqual([
      "zoom:b1:recording:sess_1__",
      "zoom:b1:recording:sess_1__",
      "zoom:b1:recording:sess2",
      "zoom:b1:recording:none",
      "zoom:b1:summary:sess2",
    ]);
    await route()(signed(event("meeting.started", { id: 81234567890, uuid: "s" })));
    expect(sent).toHaveLength(5);
  });

  it("a failing Zoom call is logged and still answered", async () => {
    const response = await route(
      SECRET,
      true,
    )(signed(event("meeting.ended", { id: 81234567890, uuid: "u1" })));
    expect(response.status).toBe(200);
    expect(errors).toEqual(["zoom webhook failed"]);
  });
});

describe("Zoom transcript pull (F2 → F6)", () => {
  const files = {
    recording_files: [
      { file_type: "MP4", download_url: "https://zoom.us/rec/mp4" },
      { file_type: "TRANSCRIPT", download_url: "https://zoom.us/rec/vtt" },
    ],
  };
  const client = (answer: unknown) => ({
    get: <T>() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T)),
    download: (url: string) => Promise.resolve(new Response(`WEBVTT from ${url}`)),
  });
  const booking = (id: string) =>
    Promise.resolve(id === "b1" ? { zoomMeetingId: "81234567890" } : null);
  const room = (zoomRequestId: string | null) => ({ room: { zoomRequestId } });

  it("downloads the TRANSCRIPT file of the room's recording, or answers null", async () => {
    expect(await createZoomTranscript({ booking, client: client(files) })(room("b1"))).toBe(
      "WEBVTT from https://zoom.us/rec/vtt",
    );
    expect(await createZoomTranscript({ booking, client: client(files) })(room(null))).toBeNull();
    expect(
      await createZoomTranscript({ booking, client: client(files) })(room("ghost")),
    ).toBeNull();
    expect(await createZoomTranscript({ booking, client: null })(room("b1"))).toBeNull();
    expect(await createZoomTranscript({ booking, client: client({}) })(room("b1"))).toBeNull();
    expect(
      await createZoomTranscript({
        booking,
        client: client(new ZoomApiError(404, "No recording")),
      })(room("b1")),
    ).toBeNull();
    await expect(
      createZoomTranscript({ booking, client: client(new ZoomApiError(500, "down")) })(room("b1")),
    ).rejects.toThrow("zoom_500");
  });
});
