import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlCampaignWebStore, createSqlSubscriberStore } from "@website/db/sql";
import { trackingLinkData } from "@website/domain/newsletter";
import { signLink } from "@website/security";
import { createNewsletter } from "../../apps/web/src/server/newsletter";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlSubscriberStore>[0];
let now = new Date("2026-10-18T00:00:00Z");
const secrets = {
  hashSecret: "subscriber-hash-secret-for-tests-0123456789",
  linkSecret: "link-signing-secret-for-tests-0123456789ab",
};
let fake: ReturnType<typeof fakeDb>;
let send: ReturnType<typeof vi.fn<(message: unknown, key: string) => Promise<string>>>;
let tokens: string[];
let newsletter: ReturnType<typeof createNewsletter>;
let trackErrors: unknown[];

beforeEach(() => {
  now = new Date("2026-10-18T00:00:00Z");
  fake = fakeDb();
  send = vi.fn((_message: unknown, _key: string) => Promise.resolve("sent"));
  tokens = ["token-1", "token-2", "token-3"];
  trackErrors = [];
  newsletter = createNewsletter({
    store: createSqlSubscriberStore(fake.db as unknown as Db),
    campaigns: createSqlCampaignWebStore(fake.db as unknown as Db),
    onTrackError: (error) => trackErrors.push(error),
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
    expect(await answer()).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const [message, key] = mail();
    expect(message.to).toBe("sari@example.org");
    const { s, t } = linkParams();
    expect(key).toBe(`newsletter:${s}:optin:1`);
    expect(message.text).not.toMatch(/confirm\S*sari/);
    expect(key).not.toContain("sari");
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await newsletter.confirm({ s, t })).toBe("confirmed");
    expect(await answer()).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(fake.docs.get(`subscribers/${s}`)).toMatchObject({ status: "confirmed" });
  });

  it("the confirmation token is single-use and expires after 48 hours", async () => {
    await newsletter.subscribe({ email: "budi@example.org", token: "good" }, "id");
    const first = linkParams();
    expect(await newsletter.confirm({ s: first.s, t: "wrong" })).toBe("invalid");
    now = new Date("2026-10-20T00:00:01Z");
    expect(await newsletter.confirm(first)).toBe("expired");
    await newsletter.subscribe({ email: "budi@example.org", token: "good" }, "id");
    expect(mail(1)[1]).toBe(`newsletter:${first.s}:optin:2`);
    const second = linkParams(1);
    expect(await newsletter.confirm(first)).toBe("invalid");
    expect(await newsletter.confirm(second)).toBe("confirmed");
    expect(await newsletter.confirm(second)).toBe("invalid");
    expect(await newsletter.confirm({ s: "bad/id", t: "x" })).toBe("invalid");
    expect(await newsletter.confirm({ s: "0".repeat(64), t: "x" })).toBe("invalid");
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
    const ghost = new URL(newsletter.unsubscribeUrl("0".repeat(64))).searchParams.get("t") ?? "";
    expect(await newsletter.unsubscribe(ghost)).toBe(false);
    await newsletter.subscribe({ email: "sari@example.org", token: "good" }, "id");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("campaign open/click tracking and the public archive", () => {
  const sid = "a".repeat(64);
  const campaign = (status: string, deletedAt: string | null = null) =>
    fake.docs.set("campaigns/c1", {
      subject: "Edisi Oktober",
      body: "<p>Halo</p>",
      segment: "all",
      status,
      sendAt: "2026-10-01T00:00:00.000Z",
      cursor: null,
      sentCount: 10,
      sentAt: "2026-10-01T01:00:00.000Z",
      version: 2,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-10-01T01:00:00.000Z",
      deletedAt,
    });
  const token = (data: Record<string, string>) => signLink(data, secrets.linkSecret);

  it("an open pixel counts once; a click redirects to the signed address only", async () => {
    campaign("sent");
    const open = token(trackingLinkData("open", "c1", sid));
    await newsletter.trackOpen(open);
    await newsletter.trackOpen(open);
    await newsletter.trackOpen(`${open}x`);
    await newsletter.trackOpen("garbage");
    expect(fake.docs.get("campaigns/c1")).toMatchObject({ openCount: 1, clickCount: 0 });
    const click = token(trackingLinkData("click", "c1", sid, "https://ppi.id/a"));
    expect(await newsletter.trackClick(click)).toBe("https://ppi.id/a");
    expect(fake.docs.get("campaigns/c1")).toMatchObject({ openCount: 1, clickCount: 1 });
    expect(await newsletter.trackClick(open)).toBeNull();
    expect(await newsletter.trackClick(`${click}x`)).toBeNull();
    expect(trackErrors).toEqual([]);
  });

  it("a failing counter never blocks the reader: the click still redirects, the error is reported", async () => {
    campaign("sent");
    const broken = createNewsletter({
      store: createSqlSubscriberStore(fake.db as unknown as Db),
      campaigns: {
        track: () => Promise.reject(new Error("down")),
        findPublic: () => Promise.resolve(null),
      },
      onTrackError: (error) => trackErrors.push(error),
      captcha: () => Promise.resolve(true),
      send,
      newToken: () => "t",
      webUrl: "https://ppiasiania.id",
      now: () => now,
      ...secrets,
    });
    const click = token(trackingLinkData("click", "c1", sid, "https://ppi.id/a"));
    expect(await broken.trackClick(click)).toBe("https://ppi.id/a");
    await broken.trackOpen(token(trackingLinkData("open", "c1", sid)));
    expect(trackErrors).toHaveLength(2);
  });

  it("the archive shows sent campaigns only", async () => {
    campaign("draft");
    expect(await newsletter.publicCampaign("c1")).toBeNull();
    campaign("sent");
    expect(await newsletter.publicCampaign("c1")).toMatchObject({
      subject: "Edisi Oktober",
      body: "<p>Halo</p>",
    });
    expect(await newsletter.publicCampaign("../x")).toBeNull();
    campaign("sent", "2026-10-02T00:00:00.000Z");
    expect(await newsletter.publicCampaign("c1")).toBeNull();
  });
});
