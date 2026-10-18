import { describe, expect, it, vi } from "vitest";
import { createFirestoreMessageLog } from "@website/db/firestore";
import {
  createMessenger,
  deliveryDecision,
  isValidMessageKey,
  type MessageChannel,
} from "@website/domain/messaging";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createMemorySender, emailChannel, type EmailSender } from "@website/email";
import { createMessageActions } from "../../apps/admin/src/server/messaging";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreMessageLog>[0];
const now = new Date("2026-10-16T05:00:00Z");
const email = (to: string | null = "ana@example.org") => ({
  channel: "email" as const,
  to,
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
});

function setup(
  options: {
    mode?: "log" | "live";
    appEnv?: "development" | "staging" | "production";
    testRecipients?: string[];
    result?: Awaited<ReturnType<MessageChannel["send"]>>;
  } = {},
) {
  const fake = fakeFirestore();
  const log = createFirestoreMessageLog(fake.db as unknown as Db);
  const send = vi.fn((..._args: Parameters<MessageChannel["send"]>) =>
    Promise.resolve(options.result ?? { ok: true as const, providerId: "re_1" }),
  );
  const messenger = createMessenger({
    log,
    channels: { email: { send } },
    mode: options.mode ?? "live",
    appEnv: options.appEnv ?? "production",
    testRecipients: options.testRecipients ?? [],
    now: () => now,
  });
  const stored = () => [...fake.docs.entries()].filter(([p]) => p.startsWith("messageLog/"));
  return { fake, log, send, messenger, stored };
}

describe("message keys", () => {
  it("are meaningful, colon-separated and safe", () => {
    expect(isValidMessageKey("event:e1:registered:uid-9")).toBe(true);
    expect(isValidMessageKey("newsletter:abc:optin:1")).toBe(true);
    for (const bad of ["", "no spaces here", "a/b", "x".repeat(301), "trailing:"]) {
      expect(isValidMessageKey(bad), bad).toBe(false);
    }
  });
});

describe("delivery rules (MESSAGING_MODE, live data in every environment)", () => {
  it("log mode records only; live sends in production; elsewhere only to test recipients", () => {
    const base = { recipient: "ana@example.org", testRecipients: ["qa@example.org"] };
    expect(deliveryDecision({ ...base, mode: "log", appEnv: "production" })).toBe("log");
    expect(deliveryDecision({ ...base, mode: "live", appEnv: "production" })).toBe("send");
    expect(deliveryDecision({ ...base, mode: "live", appEnv: "staging" })).toBe("block");
    expect(
      deliveryDecision({
        ...base,
        recipient: "QA@example.org",
        mode: "live",
        appEnv: "development",
      }),
    ).toBe("send");
  });
});

describe("messenger: message log + channel, called after the record's transaction commits", () => {
  it("sends once per key, even when called twice at the same time", async () => {
    const { messenger, send, stored } = setup();
    const key = "event:e1:registered:u1";
    const results = await Promise.all([messenger.send(email(), key), messenger.send(email(), key)]);
    expect(results.sort()).toEqual(["duplicate", "sent"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]?.[1]).toMatchObject({
      key,
      status: "sent",
      providerId: "re_1",
      attempts: 1,
    });
  });

  it("log mode never calls the channel", async () => {
    const { messenger, send, stored } = setup({ mode: "log" });
    expect(await messenger.send(email(), "k:1")).toBe("logged");
    expect(send).not.toHaveBeenCalled();
    expect(stored()[0]?.[1]).toMatchObject({ status: "logged" });
  });

  it("live mode outside production is blocked unless the recipient is a test recipient", async () => {
    const { messenger, send } = setup({ appEnv: "staging", testRecipients: ["qa@example.org"] });
    expect(await messenger.send(email(), "k:1")).toBe("blocked");
    expect(await messenger.send(email("qa@example.org"), "k:2")).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a missing address is recorded as skipped; a failure keeps the reason for retry", async () => {
    const failing = setup({ result: { ok: false, error: "rejected" } });
    expect(await failing.messenger.send(email(null), "k:none")).toBe("skipped");
    expect(await failing.messenger.send(email(), "k:fail")).toBe("failed");
    const failed = await failing.log.listFailed({ limit: 10 });
    expect(failed.items).toEqual([
      expect.objectContaining({
        key: "k:fail",
        status: "failed",
        lastError: "rejected",
        attempts: 1,
      }),
    ]);
    await expect(failing.messenger.send(email(), "bad key")).rejects.toThrow();
  });
});

describe("Messages page: failed list and retry (messages.edit)", () => {
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

  it("retries a failed message once more and refuses messages that did not fail", async () => {
    const env = setup({ result: { ok: false, error: "timeout" } });
    await env.messenger.send(email(), "k:retry");
    env.send.mockResolvedValueOnce({ ok: true, providerId: "re_2" });
    const actions = createMessageActions({ messenger: env.messenger });
    const id = (await env.log.listFailed({ limit: 1 })).items[0]?.id ?? "";
    expect(await actions.retry(() => Promise.resolve(staff(["messages.read"])))({ id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await actions.retry(() => Promise.resolve(staff(["messages.edit"])))({ id })).toEqual({
      ok: true,
      data: { status: "sent" },
    });
    expect(env.stored()[0]?.[1]).toMatchObject({ status: "sent", attempts: 2, providerId: "re_2" });
    expect(
      await actions.retry(() => Promise.resolve(staff(["messages.edit"])))({ id }),
    ).toMatchObject({
      error: "refused",
    });
  });
});

describe("e-mail channel (Resend sender behind the MessageChannel port)", () => {
  const message = { ...email(), to: "ana@example.org" };

  it("sends with the message key as idempotency key", async () => {
    const sender = createMemorySender();
    expect(await emailChannel(sender, "PPIDK <noreply@example.org>").send(message, "k:1")).toEqual({
      ok: true,
      providerId: "memory-1",
    });
    expect(sender.sent[0]).toMatchObject({
      idempotencyKey: "k:1",
      from: "PPIDK <noreply@example.org>",
    });
  });

  it("fails (never throws) when not configured or when the provider refuses", async () => {
    expect(await emailChannel(null, "from@example.org").send(message, "k")).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await emailChannel(createMemorySender(), undefined).send(message, "k")).toMatchObject({
      ok: false,
    });
    const refusing: EmailSender = { send: () => Promise.resolve({ ok: false, error: "rejected" }) };
    expect(await emailChannel(refusing, "from@example.org").send(message, "k")).toEqual({
      ok: false,
      error: "rejected",
    });
  });

  it("lists failed messages page by page", async () => {
    const env = setup({ result: { ok: false, error: "timeout" } });
    await env.messenger.send(email(), "k:a");
    await env.messenger.send(email(), "k:b");
    const first = await env.log.listFailed({ limit: 1 });
    expect(first.items).toHaveLength(1);
    const second = await env.log.listFailed({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect([first.items[0]?.key, second.items[0]?.key]).toEqual(["k:b", "k:a"]);
    expect(second.nextCursor).toBeNull();
  });
});
