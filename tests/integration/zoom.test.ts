import { beforeEach, describe, expect, it } from "vitest";
import { createSqlZoomStore } from "@website/db/sql";
import { invitationText, utcDays, type ZoomRequest } from "@website/domain/zoom";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createZoomActions } from "../../apps/admin/src/server/zoom";
import {
  createZoomClient,
  zoomErrorMessage,
  ZoomApiError,
} from "../../apps/admin/src/server/zoom-client";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlZoomStore>[0];
let clock = new Date("2026-11-05T00:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const requester = staff("req", ["zoom.edit"], { type: "orgUnit", orgUnitId: "media" });
const approver = staff("boss", [
  "zoom.edit",
  "zoom.approve",
  "zoom.settings",
  "zoom.long_duration",
]);
const outsider = staff("out", ["zoom.read"], { type: "orgUnit", orgUnitId: "other" });

let fake: ReturnType<typeof fakeDb>;
let created: string[];
let failCreate: boolean;
let deleted: string[];
let errors: string[];
const store = () => createSqlZoomStore(fake.db as unknown as Db);
const actions = (withClient = true) =>
  createZoomActions({
    zoom: store(),
    client: withClient
      ? {
          createMeeting: (input) => {
            if (failCreate) return Promise.reject(new ZoomApiError(429, "Too many requests"));
            created.push(input.topic);
            return Promise.resolve({
              id: `8${created.length}12345678`,
              joinUrl: `https://zoom.us/j/${created.length}`,
            });
          },
          deleteMeeting: (id) => {
            deleted.push(id);
            return id === "bad" ? Promise.reject(new Error("down")) : Promise.resolve();
          },
        }
      : null,
    shorten: (url) => Promise.resolve(url.replace("https://zoom.us/j/", "https://goppi.id/z")),
    unitOf: (uid) =>
      Promise.resolve(
        uid === "req" ? { orgUnitId: "media", orgUnitPath: ["dirs", "media"] } : null,
      ),
    encrypt: (plain) => `enc(${plain})`,
    logError: (message) => errors.push(message),
    now: () => clock,
  });

const input = {
  topic: "Rapat kerja",
  startsAtLocal: "2026-11-10T19:00",
  timeZone: "Asia/Tokyo",
  durationMinutes: 90,
  passcode: "ppi2026",
  joinBeforeHostMinutes: 10,
  meetingId: null,
};
const settings = (extra: Record<string, unknown> = {}) => ({
  version: null,
  licences: 1,
  concurrentPerLicence: 1,
  approvalRequired: false,
  minNoticeHours: 24,
  maxDurationMinutes: 120,
  hostKey: null,
  ...extra,
});

beforeEach(() => {
  fake = fakeDb();
  created = [];
  deleted = [];
  errors = [];
  failCreate = false;
  clock = new Date("2026-11-05T00:00:00Z");
});

describe("zoom rules (F1)", () => {
  it("UTC days with an exclusive end", () => {
    expect(utcDays(new Date("2026-11-10T23:00:00Z"), new Date("2026-11-11T01:00:00Z"))).toEqual([
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(utcDays(new Date("2026-11-10T22:00:00Z"), new Date("2026-11-11T00:00:00Z"))).toEqual([
      "2026-11-10",
    ]);
  });

  it("refuses the past, short notice (said in the chosen zone) and too long", async () => {
    await actions().saveSettings(...as(approver))(settings());
    const past = await actions().request(...as(requester))({
      ...input,
      startsAtLocal: "2026-11-01T10:00",
    });
    expect(past).toMatchObject({ issues: ["The start time has passed."] });
    const soon = await actions().request(...as(requester))({
      ...input,
      startsAtLocal: "2026-11-05T19:00",
    });
    expect(soon).toMatchObject({
      issues: ["Book at least 24 hours ahead (in Asia/Tokyo that is before 4 Nov 2026, 19:00)."],
    });
    const long = await actions().request(...as(requester))({ ...input, durationMinutes: 180 });
    expect(long).toMatchObject({ issues: ["A booking may last at most 120 minutes."] });
    expect(
      await actions().request(...as(requester))({ ...input, passcode: "far too long code" }),
    ).toMatchObject({ error: "invalid_input" });
    expect(
      await actions().request(...as(requester))({ ...input, timeZone: "Nowhere/City" }),
    ).toMatchObject({ error: "invalid_input" });
    const nobody = await actions().request(
      ...as(staff("x", ["zoom.edit"], { type: "orgUnit", orgUnitId: "media" })),
    )(input);
    expect(nobody).toMatchObject({
      issues: ["You can only book Zoom for the unit of your appointment."],
    });
  });
});

describe("zoom bookings (F1)", () => {
  it("capacity: concurrent requests never take more than licences × concurrent", async () => {
    await actions().saveSettings(...as(approver))(settings());
    const results = await Promise.all([
      actions().request(...as(requester))(input),
      actions().request(...as(requester))({ ...input, startsAtLocal: "2026-11-10T20:00" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      issues: ["Every Zoom licence is booked at that time. Choose another time."],
    });
    // Back to back is fine (end is exclusive).
    const after = await actions().request(...as(requester))({
      ...input,
      startsAtLocal: "2026-11-10T20:30",
    });
    expect(after.ok).toBe(true);
    expect(fake.docs.get("zoomCapacity/2026-11-10")).toMatchObject({ slots: [{}, {}] });
  });

  it("approval: pending holds nothing; approve takes the slot and creates the room", async () => {
    const pending = await actions().request(...as(requester))(input);
    if (!pending.ok) throw new Error(JSON.stringify(pending));
    expect(pending.data).toMatchObject({ status: "pending", joinUrl: null });
    expect(fake.docs.has("zoomCapacity/2026-11-10")).toBe(false);
    expect(
      await actions().approve(...as(outsider))({ id: pending.data.id, version: 1 }),
    ).toMatchObject({
      error: "forbidden",
    });
    const approved = await actions().approve(...as(approver))({
      id: pending.data.id,
      version: 1,
      note: "OK",
    });
    expect(approved).toMatchObject({ ok: true, data: { status: "approved" } });
    const saved = (await store().get(pending.data.id)) as ZoomRequest;
    expect(saved).toMatchObject({
      joinUrl: "https://zoom.us/j/1",
      shortUrl: "https://goppi.id/z1",
      zoomMeetingId: "8112345678",
      decisionNote: "OK",
    });
    const invitation = invitationText(saved);
    expect(invitation).toContain("Join Zoom: https://goppi.id/z1");
    expect(invitation).toContain("Meeting ID: 811 234 5678");
    expect(invitation).toContain("Passcode: ppi2026");
    expect(invitationText({ ...saved, shortUrl: null })).toContain(
      "Join Zoom: https://zoom.us/j/1",
    );
    expect(await actions().approve(...as(approver))({ id: "ghost", version: 1 })).toMatchObject({
      issues: ["This booking does not exist."],
    });
    expect(
      await actions().reject(...as(approver))({ id: pending.data.id, version: 1 }),
    ).toMatchObject({
      error: "conflict",
    });
    expect(
      await actions().approve(...as(approver))({ id: pending.data.id, version: 3 }),
    ).toMatchObject({
      issues: ["This booking is approved."],
    });

    const second = await actions().request(...as(requester))(input);
    if (!second.ok) throw new Error("second");
    expect(
      await actions().approve(...as(approver))({ id: second.data.id, version: 1 }),
    ).toMatchObject({
      issues: ["Every Zoom licence is booked at that time. Choose another time."],
    });
    const third = await actions().request(...as(requester))(input);
    if (!third.ok) throw new Error("third");
    expect((await actions().cancel(...as(requester))({ id: third.data.id, version: 1 })).ok).toBe(
      true,
    );
    expect(
      await actions().reject(...as(approver))({ id: second.data.id, version: 1, note: "Full" }),
    ).toMatchObject({
      ok: true,
      data: { status: "rejected" },
    });
    clock = new Date("2026-11-11T00:00:00Z");
    const late = await actions().request(...as(approver))({
      ...input,
      startsAtLocal: "2026-11-20T19:00",
    });
    if (!late.ok) throw new Error("late");
    clock = new Date("2026-11-21T00:00:00Z");
    expect(
      await actions().approve(...as(approver))({ id: late.data.id, version: 1 }),
    ).toMatchObject({
      issues: ["The start time has passed."],
    });
  });

  it("a failed room keeps the slot; the cron job retries; cancel frees the slot and deletes", async () => {
    await actions().saveSettings(...as(approver))(settings());
    failCreate = true;
    const booked = await actions().request(...as(requester))(input);
    if (!booked.ok) throw new Error("booked");
    expect(booked.data).toMatchObject({ status: "approved", joinUrl: null });
    expect(errors).toEqual(["zoom room failed"]);
    const held = (await store().get(booked.data.id)) as ZoomRequest;
    expect(held.roomError).toContain("zoom_429");
    // The same failure again writes nothing new.
    expect(await actions().retryRooms()).toEqual({ tried: 1, created: 0 });
    expect(((await store().get(booked.data.id)) as ZoomRequest).version).toBe(held.version);
    expect(await actions(false).retryRooms()).toEqual({ tried: 1, created: 0 });
    failCreate = false;
    expect(await actions().retryRooms()).toEqual({ tried: 1, created: 1 });
    expect(await actions().retryRooms()).toEqual({ tried: 0, created: 0 });

    const room = (await store().get(booked.data.id)) as ZoomRequest;
    expect(
      await actions().cancel(...as(outsider))({ id: room.id, version: room.version }),
    ).toMatchObject({
      issues: ["Only the requester or an approver can cancel this booking."],
    });
    expect(
      (await actions().cancel(...as(requester))({ id: room.id, version: room.version })).ok,
    ).toBe(true);
    expect(deleted).toEqual([room.zoomMeetingId]);
    expect(fake.docs.get("zoomCapacity/2026-11-10")).toEqual({ slots: [] });
    expect(
      await actions().cancel(...as(approver))({ id: room.id, version: room.version + 1 }),
    ).toMatchObject({
      issues: ["This booking is cancelled."],
    });

    const again = await actions().request(...as(requester))(input);
    if (!again.ok) throw new Error("again");
    fake.docs.set(`zoomRequests/${again.data.id}`, {
      ...fake.docs.get(`zoomRequests/${again.data.id}`),
      zoomMeetingId: "bad",
    });
    expect((await actions().cancel(...as(requester))({ id: again.data.id, version: 2 })).ok).toBe(
      true,
    );
    expect(errors).toContain("zoom delete failed");
    expect(await store().get("bad id")).toBeNull();
    expect((await store().listBetween(new Date("2026-11-01"), new Date("2026-11-30"))).length).toBe(
      2,
    );
  });

  it("a booking changed while its room was made records that instead", async () => {
    await actions().saveSettings(...as(approver))(settings());
    const zoom = store();
    const racing = createZoomActions({
      zoom: {
        ...zoom,
        write: (id, v, build, audit, now) =>
          id === null
            ? zoom.write(id, v, build, audit, now)
            : zoom.write(
                id,
                v,
                (current, s) => build({ ...(current as ZoomRequest), status: "cancelled" }, s),
                audit,
                now,
              ),
      },
      client: {
        createMeeting: () => Promise.resolve({ id: "1", joinUrl: "https://zoom.us/j/9" }),
        deleteMeeting: () => Promise.resolve(),
      },
      shorten: (url) => Promise.resolve(url),
      unitOf: () => Promise.resolve({ orgUnitId: "media", orgUnitPath: ["dirs", "media"] }),
      encrypt: null,
      logError: () => undefined,
      now: () => clock,
    });
    const result = await racing.request(...as(requester))(input);
    if (!result.ok) throw new Error("racing");
    expect((await zoom.get(result.data.id))?.roomError).toBe(
      "Booking changed before the room was saved.",
    );
  });

  it("settings: the Host Key is stored encrypted, kept, or removed; never logged in clear", async () => {
    const first = await actions().saveSettings(...as(approver))(settings({ hostKey: "987123" }));
    if (!first.ok) throw new Error("settings");
    expect((await store().readSettings()).settings.hostKeyEncrypted).toBe("enc(987123)");
    expect(
      JSON.stringify([...fake.docs.entries()].filter(([k]) => k.startsWith("auditLogs"))),
    ).not.toContain("987123");
    await actions().saveSettings(...as(approver))(settings({ version: 1, licences: 3 }));
    expect((await store().readSettings()).settings).toMatchObject({
      licences: 3,
      hostKeyEncrypted: "enc(987123)",
    });
    await actions().saveSettings(...as(approver))(settings({ version: 2, hostKey: "" }));
    expect((await store().readSettings()).settings.hostKeyEncrypted).toBeNull();
    expect(await actions().saveSettings(...as(approver))(settings({ version: 1 }))).toMatchObject({
      error: "conflict",
    });
    const noKey = createZoomActions({
      ...{
        zoom: store(),
        client: null,
        shorten: () => Promise.resolve(""),
        unitOf: () => Promise.resolve(null),
        logError: () => undefined,
        now: () => clock,
      },
      encrypt: null,
    });
    expect(
      await noKey.saveSettings(...as(approver))(settings({ version: 3, hostKey: "654321" })),
    ).toMatchObject({
      issues: ["FIELD_ENCRYPTION_KEY is not set; the Host Key cannot be stored."],
    });
    expect(await actions().saveSettings(...as(requester))(settings({ version: 3 }))).toMatchObject({
      error: "forbidden",
    });
  });
});

describe("Zoom API client", () => {
  it("caches the S2S token, sends meetings, parses JSON and XML errors, treats a 404 delete as done", async () => {
    let ms = 0;
    const calls: Array<{ url: string; method: string; body: unknown; auth: string }> = [];
    const answers: Array<{ status: number; body: string }> = [
      { status: 200, body: JSON.stringify({ access_token: "t1", expires_in: 3600 }) },
      {
        status: 201,
        body: JSON.stringify({ id: 81234567890, join_url: "https://zoom.us/j/81234567890" }),
      },
      { status: 204, body: "" },
      { status: 404, body: JSON.stringify({ code: 3001, message: "Meeting does not exist" }) },
      { status: 200, body: JSON.stringify({ access_token: "t2", expires_in: 3600 }) },
      { status: 500, body: "<error><message>Server down</message></error>" },
      { status: 200, body: JSON.stringify({ meetings: [] }) },
      { status: 200, body: "file" },
    ];
    const client = createZoomClient(
      { accountId: "acc", clientId: "id", clientSecret: "secret", hostUser: "host@example.org" },
      ((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? (JSON.parse(init.body as string) as unknown) : null,
          auth: (init.headers as Record<string, string>)["Authorization"] as string,
        });
        const next = answers.shift() as { status: number; body: string };
        return Promise.resolve(
          new Response(next.status === 204 ? null : next.body, { status: next.status }),
        );
      }) as unknown as typeof fetch,
      () => ms,
    );
    expect(
      await client.createMeeting({
        topic: "Rapat",
        startsAt: new Date("2026-11-10T10:00:00.000Z"),
        durationMinutes: 90,
        timeZone: "Asia/Tokyo",
        passcode: "ppi",
        joinBeforeHostMinutes: 0,
      }),
    ).toEqual({ id: "81234567890", joinUrl: "https://zoom.us/j/81234567890" });
    await client.updateMeeting("81234567890", { settings: { waiting_room: true } });
    await client.deleteMeeting("81234567890");
    ms = 3_600_000;
    await expect(client.deleteMeeting("1")).rejects.toThrow("zoom_500: Server down");
    expect(await client.get<{ meetings: unknown[] }>("/users/me/recordings")).toEqual({
      meetings: [],
    });
    expect(await (await client.download("https://zoom.us/rec/file")).text()).toBe("file");
    expect(calls[0]).toMatchObject({
      url: "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acc",
      auth: `Basic ${Buffer.from("id:secret").toString("base64")}`,
    });
    expect(calls[1]).toMatchObject({
      url: "https://api.zoom.us/v2/users/host%40example.org/meetings",
      auth: "Bearer t1",
      body: {
        type: 2,
        start_time: "2026-11-10T10:00:00Z",
        password: "ppi",
        settings: { join_before_host: false, jbh_time: 0 },
      },
    });
    expect(calls.filter((c) => c.url.startsWith("https://zoom.us/oauth"))).toHaveLength(2);
    expect(calls[5]?.auth).toBe("Bearer t2");
    expect(zoomErrorMessage("")).toBe("no message");
    expect(zoomErrorMessage('{"code":1}')).toBe('{"code":1}');
  });
});
