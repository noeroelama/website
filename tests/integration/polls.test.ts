import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqlSurveyStore, createSqlWebhookEventStore } from "@website/db/sql";
import { STAR_OPTIONS, starsOf, surveySummary, type Survey } from "@website/domain/messaging";
import { createPolls, createWahaWebhookRoute } from "../../apps/admin/src/server/polls";
import { wahaPoll } from "../../apps/admin/src/server/whatsapp";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlSurveyStore>[0];
const now = new Date("2026-11-05T05:00:00Z");
const SECRET = "waha-webhook-secret-123";
const labels = Object.keys(STAR_OPTIONS);
let fake: ReturnType<typeof fakeDb>;
const surveys = () => createSqlSurveyStore(fake.db as unknown as Db);

beforeEach(() => {
  fake = fakeDb();
});

describe("poll rules (J3)", () => {
  it("stars come from the survey's frozen options; summary per source", () => {
    expect(starsOf({ options: STAR_OPTIONS }, [labels[0] as string])).toBe(5);
    expect(starsOf({ options: { Old: 2 } }, ["Old"])).toBe(2);
    expect(starsOf({ options: STAR_OPTIONS }, ["Renamed"])).toBeNull();
    expect(starsOf({ options: STAR_OPTIONS }, [])).toBeNull();
    const rows = surveySummary([
      { source: "finance", stars: 5 },
      { source: "finance", stars: 4 },
      { source: "finance", stars: null },
    ]);
    expect(rows[0]).toEqual({
      source: "finance",
      sent: 3,
      answered: 2,
      average: 4.5,
      distribution: [0, 0, 0, 1, 1],
    });
    expect(rows[1]).toEqual({
      source: "lpj",
      sent: 0,
      answered: 0,
      average: null,
      distribution: [0, 0, 0, 0, 0],
    });
  });
});

describe("sending polls (J3)", () => {
  const contacts = (uids: readonly string[]) =>
    Promise.resolve(
      new Map(
        uids.map((u) => [
          u,
          { email: `${u}@example.org`, phone: u === "nophone" ? null : `+62811${u.length}0000` },
        ]),
      ),
    );
  it("once per event and person, only on WhatsApp, only when messages may be sent", async () => {
    const asked: string[] = [];
    const errors: string[] = [];
    const polls = (mode: "live" | "log", fail: string | null = null) =>
      createPolls({
        surveys: surveys(),
        contacts,
        sendPoll: (to, question, options) => {
          asked.push(`${to}:${options.length}:${question.slice(0, 10)}`);
          return Promise.resolve(
            fail
              ? { ok: false as const, error: fail }
              : { ok: true as const, messageId: `poll-${asked.length}` },
          );
        },
        delivery: { mode, appEnv: "production", testRecipients: [] },
        logError: (message) => errors.push(message),
        now: () => now,
      });
    expect(await polls("log").ask(["ari"], "finance", "f1")).toBe(0);
    expect(await polls("live").ask(["ari", "nophone"], "finance", "f1")).toBe(1);
    expect(await polls("live").ask(["ari"], "finance", "f1")).toBe(0);
    expect(asked).toEqual(["+6281130000:5:Seberapa p"]);
    expect(await polls("live", "waha_500").ask(["budi"], "lpj", "l1")).toBe(0);
    expect(errors).toEqual(["poll failed"]);
    const broken = createPolls({
      surveys: surveys(),
      contacts: () => Promise.reject(new Error("db down")),
      sendPoll: () => Promise.resolve({ ok: false, error: "x" }),
      delivery: { mode: "live", appEnv: "production", testRecipients: [] },
      logError: (message) => errors.push(message),
      now: () => now,
    });
    expect(await broken.ask(["ari"], "lpj", "l2")).toBe(0);
    expect(errors).toHaveLength(2);
    const stored = await surveys().since(new Date(0));
    expect(stored.find((s) => s.uid === "ari")).toMatchObject({
      pollMessageId: "poll-1",
      stars: null,
      options: STAR_OPTIONS,
    });
  });

  it("the WAHA adapter sends a single-answer poll and reads the message id", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchOk = ((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) as unknown });
      return Promise.resolve(Response.json({ id: { _serialized: "true_628@c.us_ABC" } }));
    }) as unknown as typeof fetch;
    const config = { baseUrl: "https://waha.example.org/", apiKey: "k", session: "default" };
    expect(await wahaPoll(config, fetchOk)("+628111", "Q?", ["a", "b"])).toEqual({
      ok: true,
      messageId: "true_628@c.us_ABC",
    });
    expect(calls[0]).toEqual({
      url: "https://waha.example.org/api/sendPoll",
      body: {
        session: "default",
        chatId: "628111@c.us",
        poll: { name: "Q?", options: ["a", "b"], multipleAnswers: false },
      },
    });
    const answer = (response: Response | Error) =>
      wahaPoll(config, () =>
        response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      )("+628111", "Q", ["a"]);
    expect(await answer(Response.json({ id: "plain-id" }))).toEqual({
      ok: true,
      messageId: "plain-id",
    });
    expect(await answer(Response.json({}))).toEqual({ ok: false, error: "waha_no_id" });
    expect(await answer(new Response("nope", { status: 200 }))).toEqual({
      ok: false,
      error: "waha_no_id",
    });
    expect(await answer(new Response("", { status: 502 }))).toEqual({
      ok: false,
      error: "waha_502",
    });
    expect(await answer(new Error("offline"))).toEqual({ ok: false, error: "waha_unreachable" });
    expect(await wahaPoll(null)("+628111", "Q", ["a"])).toEqual({
      ok: false,
      error: "not_configured",
    });
  });
});

describe("POST /webhooks/waha (J3)", () => {
  const route = (secret = SECRET) =>
    createWahaWebhookRoute({
      secret: secret || undefined,
      record: (provider, id, at) =>
        createSqlWebhookEventStore(fake.db as unknown as Db).record(provider, id, at),
      surveys: surveys(),
      now: () => now,
    });
  const signed = (body: unknown, secret = SECRET) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Request("https://admin.example.org/webhooks/waha", {
      method: "POST",
      headers: { "x-webhook-hmac": createHmac("sha512", secret).update(text).digest("hex") },
      body: text,
    });
  };
  const vote = (selected: unknown, ts = 1, pollId = "poll-1") => ({
    event: "poll.vote",
    session: "default",
    payload: {
      vote: { id: "vote-1", selectedOptions: selected, timestamp: ts },
      poll: { id: pollId },
    },
  });

  beforeEach(async () => {
    const survey = (await surveys().claim("finance", "f1", "ari", STAR_OPTIONS, now)) as Survey;
    await surveys().setPollMessage(survey.id, "poll-1");
  });

  it("records the vote by the poll id; a change counts, a duplicate does not", async () => {
    expect((await route()(signed(vote([labels[1]])))).status).toBe(200);
    expect((await surveys().since(new Date(0)))[0]).toMatchObject({ stars: 4, votedAt: now });
    await route()(signed(vote([labels[4]], 2)));
    expect((await surveys().since(new Date(0)))[0]?.stars).toBe(1);
    await surveys().vote("poll-1", () => 3, now);
    await route()(signed(vote([labels[4]], 2)));
    expect((await surveys().since(new Date(0)))[0]?.stars).toBe(3);
    expect((await route()(signed(vote([labels[0]], 3, "unknown-poll")))).status).toBe(200);
    expect(await surveys().vote("unknown-poll", () => 5, now)).toBe(false);
  });

  it("refuses forged, unsigned, oversized and malformed requests; ignores other events", async () => {
    expect((await route()(signed(vote([labels[0]]), "wrong-secret-0000000"))).status).toBe(401);
    expect((await route("")(signed(vote([labels[0]])))).status).toBe(401);
    const unsigned = new Request("https://admin.example.org/webhooks/waha", {
      method: "POST",
      body: "{}",
    });
    expect((await route()(unsigned)).status).toBe(401);
    const big = new Request("https://admin.example.org/webhooks/waha", {
      method: "POST",
      headers: { "content-length": String(100 * 1024) },
      body: "x",
    });
    expect((await route()(big)).status).toBe(413);
    expect((await route()(signed("not json"))).status).toBe(400);
    expect((await route()(signed({ event: "message", payload: {} }))).status).toBe(200);
    expect((await route()(signed({ event: "poll.vote", payload: {} }))).status).toBe(400);
    expect((await route()(signed(vote("not a list")))).status).toBe(400);
    expect((await route()(signed(vote([5, labels[0]])))).status).toBe(200);
    expect((await surveys().since(new Date(0)))[0]?.stars).toBe(5);
  });
});
