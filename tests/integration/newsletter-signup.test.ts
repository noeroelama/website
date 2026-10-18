import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreSubscriberStore } from "@website/db/firestore";
import { createNewsletter } from "../../apps/web/src/server/newsletter";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreSubscriberStore>[0];
let now = new Date("2026-10-18T00:00:00Z");
const secrets = {
  hashSecret: "subscriber-hash-secret-for-tests-0123456789",
  linkSecret: "link-signing-secret-for-tests-0123456789ab",
};
let fake: ReturnType<typeof fakeFirestore>;
let send: ReturnType<typeof vi.fn<(message: unknown, key: string) => Promise<string>>>;
let tokens: string[];
let newsletter: ReturnType<typeof createNewsletter>;

beforeEach(() => {
  now = new Date("2026-10-18T00:00:00Z");
  fake = fakeFirestore();
  send = vi.fn((_message: unknown, _key: string) => Promise.resolve("sent"));
  tokens = ["token-1", "token-2", "token-3"];
  newsletter = createNewsletter({
    store: createFirestoreSubscriberStore(fake.db as unknown as Db),
    captcha: (token) => Promise.resolve(token === "good"),
    send,
    newToken: () => tokens.shift() ?? "token-x",
    webUrl: "https://ppiasiania.id",
    now: () => now,
    ...secrets,
  });
});

const mail = (i = 0) =>
  send.mock.calls[i] as unknown as [{ to: string; text: string; html: string }, string];
const linkParams = (i = 0) => {
  const url = new URL(/https:\/\/\S+confirm\S+/.exec(mail(i)[0].text)![0]);
  return { s: url.searchParams.get("s") ?? "", t: url.searchParams.get("t") ?? "" };
};

describe("newsletter sign-up with double opt-in", () => {
  it("bad address or failed captcha: an inline error, nothing written, nothing sent", async () => {
    expect(await newsletter.subscribe({ email: "nope", token: "good" }, "id")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await newsletter.subscribe({ email: "sari@example.org", token: "bad" }, "id")).toEqual({
      ok: false,
      error: "captcha",
    });
    expect(await newsletter.subscribe({ extra: 1 }, "id")).toMatchObject({ error: "invalid" });
    expect(fake.docs.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("new, pending and confirmed addresses all get the same answer (no enumeration)", async () => {
    const answer = () => newsletter.subscribe({ email: " Sari@Example.org ", token: "good" }, "en");
    expect(await answer()).toEqual({ ok: true });
    expect(await answer()).toEqual({ ok: true }); // pending: nothing new is sent
    expect(send).toHaveBeenCalledTimes(1);
    const [message, key] = mail();
    expect(message.to).toBe("sari@example.org");
    const { s, t } = linkParams();
    expect(key).toBe(`newsletter:${s}:optin:1`);
    // The e-mail address appears in no URL and no key: the id is a keyed hash.
    expect(message.text).not.toMatch(/confirm\S*sari/);
    expect(key).not.toContain("sari");
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await newsletter.confirm({ s, t })).toBe("confirmed");
    expect(await answer()).toEqual({ ok: true }); // confirmed: still the same answer
    expect(send).toHaveBeenCalledTimes(1);
    expect(fake.docs.get(`subscribers/${s}`)).toMatchObject({ status: "confirmed" });
  });

  it("the confirmation token is single-use and expires after 48 hours", async () => {
    await newsletter.subscribe({ email: "budi@example.org", token: "good" }, "id");
    const first = linkParams();
    expect(await newsletter.confirm({ s: first.s, t: "wrong" })).toBe("invalid");
    now = new Date("2026-10-20T00:00:01Z");
    expect(await newsletter.confirm(first)).toBe("expired");
    // Expired: subscribing again sends a fresh link (opt-in #2), the old one stays dead.
    await newsletter.subscribe({ email: "budi@example.org", token: "good" }, "id");
    expect(mail(1)[1]).toBe(`newsletter:${first.s}:optin:2`);
    const second = linkParams(1);
    expect(await newsletter.confirm(first)).toBe("invalid");
    expect(await newsletter.confirm(second)).toBe("confirmed");
    expect(await newsletter.confirm(second)).toBe("invalid");
    expect(await newsletter.confirm({ s: "bad/id", t: "x" })).toBe("invalid");
  });

  it("unsubscribes only through a validly signed link", async () => {
    await newsletter.subscribe({ email: "sari@example.org", token: "good" }, "id");
    const { s } = linkParams();
    const link = newsletter.unsubscribeUrl(s);
    expect(link).toMatch(/^https:\/\/ppiasiania\.id\/newsletter\/unsubscribe\?t=/);
    const token = new URL(link).searchParams.get("t") ?? "";
    expect(await newsletter.unsubscribe(`${token}x`)).toBe(false);
    expect(await newsletter.unsubscribe("garbage")).toBe(false);
    expect(await newsletter.unsubscribe(token)).toBe(true);
    expect(fake.docs.get(`subscribers/${s}`)).toMatchObject({ status: "unsubscribed" });
    // A link for a subscriber that does not exist does nothing.
    const ghost = new URL(newsletter.unsubscribeUrl("0".repeat(64))).searchParams.get("t") ?? "";
    expect(await newsletter.unsubscribe(ghost)).toBe(false);
    // Unsubscribed people may sign up again (a new opt-in).
    await newsletter.subscribe({ email: "sari@example.org", token: "good" }, "id");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
