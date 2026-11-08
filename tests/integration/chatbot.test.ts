import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlConversationStore,
  createSqlWebhookEventStore,
  deleteExpired,
} from "@website/db/sql";
import {
  cloudApiReply,
  createChatbot,
  createWhatsappWebhook,
  CONVERSATION_TTL_MS,
} from "../../apps/admin/src/server/chatbot";
import { geminiCampusMatcher } from "../../apps/admin/src/server/gemini";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlConversationStore>[0];
let clock = new Date("2026-11-05T05:00:00Z");
let fake: ReturnType<typeof fakeDb>;
let accounts: string[];
let openList: Array<{ id: string; title: string }>;
let errors: string[];
let matcher: ((typed: string, names: readonly string[]) => Promise<number | null>) | null;

const bot = () =>
  createChatbot({
    conversations: createSqlConversationStore(fake.db as unknown as Db),
    phoneId: (phone) => `h${phone.replace(/\D/g, "")}`,
    chapters: () =>
      Promise.resolve([
        { id: "jp", name: "PPI Jepang", countryCode: "JP" },
        { id: "au", name: "PPI Australia", countryCode: "AU" },
      ]),
    universities: (cc) =>
      Promise.resolve(
        cc === "JP"
          ? [
              { id: "u-tokyo", name: "The University of Tokyo" },
              { id: "u-kyoto", name: "Kyoto University" },
              { id: "u-tit", name: "Tokyo Institute of Technology" },
            ]
          : [],
      ),
    matchCampus: matcher,
    ensureAccount: (email, name) => {
      accounts.push(`${email}:${name}`);
      return Promise.resolve("uid-new");
    },
    recordUser: (uid, email) => {
      accounts.push(`record:${uid}:${email}`);
      return Promise.resolve();
    },
    openRecruitments: () => Promise.resolve(openList),
    webUrl: "https://ppi.example.org",
    logError: (message) => errors.push(message),
    now: () => clock,
  });

beforeEach(() => {
  fake = fakeDb();
  accounts = [];
  openList = [{ id: "rec1", title: "Oprec Pengurus 2026" }];
  errors = [];
  matcher = null;
  clock = new Date("2026-11-05T05:00:00Z");
});

const say = async (...lines: string[]) => {
  const replies: string[] = [];
  for (const line of lines) replies.push(await bot()("+6281234567890", line));
  return replies;
};

describe("WhatsApp chatbot (C4)", () => {
  it("keywords: menu, bantuan, batal; anything else shows the menu", async () => {
    const [menu, help, cancel, other] = await say("Menu", "bantuan", "batal", "apa ini");
    expect(menu).toContain("daftar");
    expect(help).toContain("Lupa kata sandi");
    expect(cancel).toContain("Dibatalkan");
    expect(other).toBe(menu);
    expect(await say("hai")).toEqual([menu]);
  });

  it("signs up: name → e-mail → chapter → campus → pick → confirm → account", async () => {
    const replies = await say(
      "daftar",
      "x",
      "  Rina   Putri ",
      "not-an-email",
      "Rina@Example.org",
      "9",
      "1",
      "tokyo",
      "7",
      "university of tokyo",
      "1",
      "mungkin",
      "ya",
    );
    expect(replies[1]).toContain("Ketik nama");
    expect(replies[3]).toContain("tidak valid");
    expect(replies[4]).toContain("1. PPI Jepang");
    expect(replies[5]).toContain("Balas dengan nomor");
    expect(replies[7]).toContain("1. The University of Tokyo\n2. Tokyo Institute of Technology");
    expect(replies[8]).toContain("tidak ditemukan");
    expect(replies[10]).toContain("Rina Putri\nrina@example.org\nThe University of Tokyo");
    expect(replies[11]).toContain("Balas *ya*");
    expect(replies[12]).toContain("Akun dibuat untuk rina@example.org");
    expect(accounts).toEqual(["rina@example.org:Rina Putri", "record:uid-new:rina@example.org"]);
    expect(fake.docs.has("whatsappConversations/h6281234567890")).toBe(false);
  });

  it("the machine matcher helps only when the deterministic search finds nothing", async () => {
    matcher = (typed, names) =>
      Promise.resolve(typed === "Todai" ? names.indexOf("The University of Tokyo") : null);
    const replies = await say("daftar", "Budi", "budi@example.org", "1", "Todai", "nowhere");
    expect(replies[4]).toContain("1. The University of Tokyo");
    expect(replies[5]).toContain("tidak ditemukan");
    matcher = () => Promise.reject(new Error("gemini down"));
    expect((await say("daftar", "Budi", "budi@example.org", "1", "Todai"))[4]).toContain(
      "tidak ditemukan",
    );
    expect(errors).toEqual(["campus match failed"]);
    matcher = () => Promise.resolve(99);
    expect((await say("daftar", "Budi", "budi@example.org", "1", "Todai"))[4]).toContain(
      "tidak ditemukan",
    );
    expect((await say("daftar", "Budi", "budi@example.org", "2", "UNSW"))[4]).toContain(
      "tidak ditemukan",
    );
  });

  it("oprec lists open recruitments and answers the apply link", async () => {
    const [list, wrong, link] = await say("oprec", "5", "1");
    expect(list).toContain("1. Oprec Pengurus 2026");
    expect(wrong).toContain("Balas dengan nomor");
    expect(link).toContain("https://ppi.example.org/recruitment/rec1");
    openList = [];
    expect(await say("oprec")).toEqual(["Belum ada lowongan dibuka. / No open recruitments now."]);
  });

  it("an expired conversation starts over (and is deleted by the expire job)", async () => {
    await say("daftar");
    clock = new Date(clock.getTime() + CONVERSATION_TTL_MS + 1);
    const [reply] = await say("Rina");
    expect(reply).toContain("Menu");
    await say("daftar");
    clock = new Date(clock.getTime() + CONVERSATION_TTL_MS + 1);
    expect((await deleteExpired(fake.db as unknown as Db, clock)).whatsappConversations).toBe(1);
  });
});

describe("/webhooks/whatsapp (C4)", () => {
  const SECRET = "meta-app-secret";
  const sent: string[] = [];
  const hook = (
    secret = SECRET,
    send = (to: string, body: string) => {
      sent.push(`${to}:${body.slice(0, 10)}`);
      return Promise.resolve();
    },
  ) =>
    createWhatsappWebhook({
      verifyToken: "verify-token-123456",
      appSecret: secret || undefined,
      record: (p, id, at) => createSqlWebhookEventStore(fake.db as unknown as Db).record(p, id, at),
      handle: (phone, text) => Promise.resolve(`${phone}|${text}`),
      send,
      logError: (message) => errors.push(message),
      now: () => clock,
    });
  const signed = (body: unknown, secret = SECRET) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Request("https://admin.example.org/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
      },
      body: text,
    });
  };
  const payload = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });

  beforeEach(() => {
    sent.length = 0;
  });

  it("answers the verify-token handshake only with the right token", async () => {
    const ok = hook().verify(
      new URL(
        "https://a/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-123456&hub.challenge=42",
      ),
    );
    expect(await ok.text()).toBe("42");
    expect(
      hook().verify(new URL("https://a/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no"))
        .status,
    ).toBe(403);
    expect(
      hook().verify(
        new URL(
          "https://a/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-123456",
        ),
      ).status,
    ).toBe(200);
  });

  it("checks the signature, de-duplicates by message id and replies via the Cloud API", async () => {
    const body = payload([
      { id: "wamid.1", from: "6281234567890", type: "text", text: { body: "menu" } },
      {
        id: "wamid.2",
        from: "6281234567890",
        type: "interactive",
        interactive: { list_reply: { id: "2" } },
      },
      {
        id: "wamid.3",
        from: "6281234567890",
        type: "interactive",
        interactive: { button_reply: { id: "ya" } },
      },
      { id: "wamid.4", from: "6281234567890", type: "image" },
    ]);
    expect((await hook().receive(signed(body))).status).toBe(200);
    expect((await hook().receive(signed(body))).status).toBe(200);
    expect(sent).toEqual([
      "6281234567890:+628123456",
      "6281234567890:+628123456",
      "6281234567890:+628123456",
    ]);
    expect((await hook().receive(signed(body, "forged"))).status).toBe(401);
    expect((await hook("").receive(signed(body))).status).toBe(401);
    const unsigned = new Request("https://a/webhooks/whatsapp", { method: "POST", body: "{}" });
    expect((await hook().receive(unsigned)).status).toBe(401);
    expect((await hook().receive(signed("not json"))).status).toBe(400);
    expect((await hook().receive(signed({}))).status).toBe(200);
    expect((await hook().receive(signed({ entry: [{}, { changes: [{}] }] }))).status).toBe(200);
    const big = new Request("https://a/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-length": String(200 * 1024) },
      body: "x",
    });
    expect((await hook().receive(big)).status).toBe(413);
    const failing = hook(SECRET, () => Promise.reject(new Error("meta down")));
    await failing.receive(
      signed(payload([{ id: "wamid.9", from: "62811", text: { body: "menu" } }])),
    );
    expect(errors).toEqual(["chatbot failed"]);
  });

  it("Cloud API reply and Gemini matcher adapters", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchWith = (response: Response) =>
      ((url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string) as unknown });
        return Promise.resolve(response);
      }) as unknown as typeof fetch;
    await cloudApiReply({ phoneNumberId: "123", token: "t" }, fetchWith(new Response("{}")))(
      "62811",
      "Halo",
    );
    expect(calls[0]).toEqual({
      url: "https://graph.facebook.com/v21.0/123/messages",
      body: { messaging_product: "whatsapp", to: "62811", type: "text", text: { body: "Halo" } },
    });
    await expect(cloudApiReply(null, fetchWith(new Response()))("62811", "x")).rejects.toThrow(
      "not_configured",
    );
    await expect(
      cloudApiReply(
        { phoneNumberId: "1", token: "t" },
        fetchWith(new Response("", { status: 401 })),
      )("6", "x"),
    ).rejects.toThrow("whatsapp_cloud_401");

    const gemini = (text: string | null, status = 200) =>
      geminiCampusMatcher(
        "g-key",
        fetchWith(
          Response.json(text === null ? {} : { candidates: [{ content: { parts: [{ text }] } }] }, {
            status,
          }),
        ),
      )("todai", ["A", "B"]);
    expect(await gemini("2")).toBe(1);
    expect(await gemini("0")).toBeNull();
    expect(await gemini("7")).toBeNull();
    expect(await gemini(null)).toBeNull();
    await expect(gemini("1", 500)).rejects.toThrow("gemini_500");
    expect(
      String(
        (calls.at(-1)?.body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0]
          ?.parts[0]?.text,
      ),
    ).toContain("1. A\n2. B");
  });
});
