import { beforeEach, describe, expect, it } from "vitest";
import { createSqlMessageLog } from "@website/db/sql";
import type { Certificate, Letter } from "@website/domain/documents";
import { createMessenger, type MessageChannel } from "@website/domain/messaging";
import { normalizePermissions, type Principal } from "@website/permissions";
import {
  certificateSendKey,
  createCertificateSending,
  SEND_BATCH,
} from "../../apps/admin/src/server/certificates";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMessageLog>[0];
const now = new Date("2026-11-05T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const editor = staff(["letters.edit"]);

let fake: ReturnType<typeof fakeDb>;
let delivered: Array<{ channel: string; to: string | null; key: string; text: string }>;
let failFor: Set<string>;
let status: Letter["status"];

const sheets = (count: number): Certificate[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `b1_${i + 1}`,
    batchId: "b1",
    seq: i + 1,
    name: `Peserta ${i + 1}`,
    note: null,
    emailHash: i === count - 1 ? null : `hash:p${i + 1}@example.org`,
  })) as unknown as Certificate[];

const sending = (count = 3) => {
  const log = createSqlMessageLog(fake.db as unknown as Db);
  const channel: MessageChannel = {
    send: (message, key) => {
      if (failFor.has(key)) return Promise.resolve({ ok: false, error: "down" });
      delivered.push({ channel: message.channel, to: message.to, key, text: message.text });
      return Promise.resolve({ ok: true, providerId: key });
    },
  };
  const messenger = createMessenger({
    log,
    channels: { email: channel, whatsapp: channel },
    mode: "live",
    appEnv: "production",
    testRecipients: [],
    now: () => now,
  });
  return createCertificateSending({
    getLetter: (id) =>
      Promise.resolve(
        id === "b1"
          ? ({
              id,
              subject: "Webinar",
              status,
              orgUnitPath: [],
              deletedAt: null,
            } as unknown as Letter)
          : null,
      ),
    list: () => Promise.resolve(sheets(count)),
    hashEmail: (email) => `hash:${email}`,
    contactOf: (email) =>
      Promise.resolve({ email, phone: email.startsWith("p1@") ? "+6281234567890" : null }),
    log,
    send: (message, key) => messenger.send(message, key),
    retry: (id) => messenger.retry(id),
    pickupUrl: "https://ppi.example.org/certificates",
  });
};
const list = (n: number) =>
  Array.from({ length: n }, (_, i) => `Peserta ${i + 1}\tp${i + 1}@example.org`).join("\n");

beforeEach(() => {
  fake = fakeDb();
  delivered = [];
  failFor = new Set();
  status = "issued";
});

describe("certificate bulk sending (D5)", () => {
  it("sends a pickup link (never the PDF) once per sheet, WhatsApp when the account has a number", async () => {
    const result = await sending().send(...as(editor))({
      batchId: "b1",
      text: `${list(2)}\nStranger\tx@example.org\nNo mail`,
    });
    expect(result).toEqual({
      ok: true,
      data: { sent: 2, remaining: 0, unmatched: 1, withoutEmail: 1 },
    });
    expect(delivered).toEqual([
      expect.objectContaining({ channel: "whatsapp", to: "+6281234567890", key: "cert:b1:1" }),
      expect.objectContaining({ channel: "email", to: "p2@example.org", key: "cert:b1:2" }),
    ]);
    expect(delivered[0]?.text).toContain("https://ppi.example.org/certificates");
    expect(delivered[0]?.text).not.toContain(".pdf");
    const again = await sending().send(...as(editor))({ batchId: "b1", text: list(2) });
    expect(again).toMatchObject({ ok: true, data: { sent: 0, remaining: 0 } });
    expect(delivered).toHaveLength(2);
    expect(await sending().progress("b1")).toEqual({ not_sent: 1, sent: 2 });
  });

  it("sends at most one batch per call; the rest on the next call", async () => {
    const count = SEND_BATCH + 6;
    const first = await sending(count).send(...as(editor))({ batchId: "b1", text: list(count) });
    expect(first).toMatchObject({ data: { sent: SEND_BATCH, remaining: 5 } });
    const second = await sending(count).send(...as(editor))({ batchId: "b1", text: list(count) });
    expect(second).toMatchObject({ data: { sent: 5, remaining: 0 } });
  });

  it("retries only the failed ones", async () => {
    failFor = new Set([certificateSendKey("b1", 2)]);
    await sending().send(...as(editor))({ batchId: "b1", text: list(2) });
    expect(await sending().progress("b1")).toEqual({ not_sent: 1, sent: 1, failed: 1 });
    failFor = new Set();
    expect(await sending().retryFailed(...as(editor))({ batchId: "b1" })).toEqual({
      ok: true,
      data: { retried: 1 },
    });
    expect(delivered.map((d) => d.key)).toEqual(["cert:b1:1", "cert:b1:2"]);
    expect(await sending().retryFailed(...as(editor))({ batchId: "b1" })).toMatchObject({
      data: { retried: 0 },
    });
  });

  it("only issued batches: a cancelled or draft batch cannot be sent; scope and permission", async () => {
    status = "cancelled";
    expect(await sending().send(...as(editor))({ batchId: "b1", text: list(2) })).toMatchObject({
      issues: ["Only an issued certificate batch can be sent."],
    });
    expect(await sending().retryFailed(...as(editor))({ batchId: "b1" })).toMatchObject({
      ok: false,
      error: "refused",
    });
    status = "draft";
    expect(await sending().send(...as(editor))({ batchId: "b1", text: list(2) })).toMatchObject({
      ok: false,
    });
    expect(await sending().send(...as(editor))({ batchId: "ghost", text: list(2) })).toMatchObject({
      ok: false,
    });
    expect(
      await sending().send(...as(staff(["letters.read"])))({ batchId: "b1", text: list(2) }),
    ).toMatchObject({ error: "forbidden" });
    expect(delivered).toEqual([]);
  });
});
