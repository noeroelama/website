import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlContactReader, createSqlMessageLog } from "@website/db/sql";
import type { Letter } from "@website/domain/documents";
import type { FinanceRequest } from "@website/domain/finance";
import { createMessenger, deliveryDecision, messageTo } from "@website/domain/messaging";
import type { LpjReport } from "@website/domain/programs";
import type { Application } from "@website/domain/recruitment";
import { normalizePermissions } from "@website/permissions";
import { createNotices } from "../../apps/admin/src/server/notices";
import { wahaChannel, whatsappChatId } from "../../apps/admin/src/server/whatsapp";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlContactReader>[0];
const now = new Date("2026-11-04T05:00:00Z");
const content = { subject: "Oprec", text: "Halo", html: "<p>Halo</p>" };

describe("per-person channel (J1)", () => {
  it("WhatsApp when the profile has a number, else e-mail, else nothing to send to", () => {
    expect(messageTo({ email: "a@example.org", phone: "+6281234567890" }, content)).toEqual({
      channel: "whatsapp",
      to: "+6281234567890",
      ...content,
    });
    expect(messageTo({ email: "a@example.org", phone: null }, content)).toMatchObject({
      channel: "email",
      to: "a@example.org",
    });
    expect(messageTo(null, content)).toMatchObject({ channel: "email", to: null });
  });

  it("test recipients may be WhatsApp numbers outside production", () => {
    const base = { mode: "live" as const, appEnv: "staging", testRecipients: ["+6281234567890"] };
    expect(deliveryDecision({ ...base, recipient: "+6281234567890" })).toBe("send");
    expect(deliveryDecision({ ...base, recipient: "+6289999999999" })).toBe("block");
  });

  it("a channel the app does not have fails as not_configured (kept for a retry)", async () => {
    const fake = fakeDb();
    const log = createSqlMessageLog(fake.db as unknown as Db);
    const messenger = createMessenger({
      log,
      channels: {},
      mode: "live",
      appEnv: "production",
      testRecipients: [],
      now: () => now,
    });
    expect(
      await messenger.send(messageTo({ email: null, phone: "+628123456" }, content), "k:1"),
    ).toBe("failed");
    const failed = await log.listFailed({ limit: 1 });
    expect(failed.items[0]).toMatchObject({ channel: "whatsapp", lastError: "not_configured" });
  });
});

describe("WAHA channel (proactive WhatsApp)", () => {
  const config = { baseUrl: "https://waha.example.org/", apiKey: "k3y", session: "ppidk" };
  const message = { channel: "whatsapp" as const, to: "+6281234567890", ...content };

  it("posts the text to the chat id of the number with the API key", async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ id: { _serialized: "true_628@c.us_ABC" } })),
    );
    expect(await wahaChannel(config, fetchImpl as never).send(message, "k:1")).toEqual({
      ok: true,
      providerId: "true_628@c.us_ABC",
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://waha.example.org/api/sendText");
    expect(init.headers).toMatchObject({ "X-Api-Key": "k3y" });
    expect(JSON.parse(init.body as string)).toEqual({
      session: "ppidk",
      chatId: "6281234567890@c.us",
      text: "*Oprec*\n\nHalo",
    });
    expect(whatsappChatId("+6281234567890")).toBe("6281234567890@c.us");
  });

  it("never throws: not configured, HTTP errors and network errors come back as reasons", async () => {
    expect(await wahaChannel(null).send(message, "k")).toEqual({
      ok: false,
      error: "not_configured",
    });
    const status = (code: number) => () => Promise.resolve(new Response("no", { status: code }));
    expect(await wahaChannel(config, status(401) as never).send(message, "k")).toEqual({
      ok: false,
      error: "waha_401",
    });
    const down = () => Promise.reject(new Error("ECONNREFUSED"));
    expect(await wahaChannel(config, down as never).send(message, "k")).toEqual({
      ok: false,
      error: "waha_unreachable",
    });
    const plain = () => Promise.resolve(new Response("ok"));
    expect(
      await wahaChannel(config, plain as never).send({ ...message, subject: "" }, "k"),
    ).toEqual({ ok: true, providerId: "" });
    const text = () => Promise.resolve(Response.json({ id: "msg-1" }));
    expect(await wahaChannel(config, text as never).send(message, "k")).toEqual({
      ok: true,
      providerId: "msg-1",
    });
  });
});

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const role = (permissions: string[]) => ({
  name: "Role",
  permissions: normalizePermissions(permissions),
  version: 1,
  deletedAt: null,
});
const user = (uid: string, assignments: Record<string, unknown>[], status = "active") => ({
  uid,
  email: `${uid}@example.org`,
  name: uid,
  status,
  version: 1,
  roleAssignments: assignments,
  roleIds: assignments.map((a) => a["roleId"]),
});
const global = { type: "global" };

beforeEach(() => {
  fake = fakeDb();
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
  fake.docs.set("roles/secretariat", role(["letters.read", "letters.review"]));
  fake.docs.set("roles/sekjen", role(["letters.read", "letters.sign", "letters.issue"]));
  fake.docs.set("roles/coordinator", role(["letters.read", "letters.sign_coordinator"]));
  fake.docs.set("roles/director", role(["letters.review"]));
  fake.docs.set("roles/treasurer", role(["finance.review", "finance.pay"]));
  fake.docs.set("roles/finance_coordinator", role(["finance.authorize"]));
  fake.docs.set("users/sekre", user("sekre", [{ roleId: "secretariat", scope: global }]));
  fake.docs.set(
    "users/old",
    user("old", [{ roleId: "secretariat", scope: global, periodId: "p0" }]),
  );
  fake.docs.set(
    "users/gone",
    user("gone", [{ roleId: "secretariat", scope: global, revokedAt: now }]),
  );
  fake.docs.set("users/off", user("off", [{ roleId: "secretariat", scope: global }], "inactive"));
  fake.docs.set(
    "users/dir",
    user("dir", [{ roleId: "director", scope: { type: "orgUnit", orgUnitId: "media" } }]),
  );
  fake.docs.set("users/boss", user("boss", [{ roleId: "superadmin", scope: global }]));
  fake.docs.set("users/rina", user("rina", [{ roleId: "sekjen", scope: global }]));
  fake.docs.set("users/koor", user("koor", [{ roleId: "coordinator", scope: global }]));
  fake.docs.set("users/ari", user("ari", []));
  fake.docs.set("users/tina", user("tina", [{ roleId: "treasurer", scope: global }]));
  fake.docs.set("users/kord", user("kord", [{ roleId: "finance_coordinator", scope: global }]));
  fake.docs.set("memberProfiles/ari", { whatsappNumber: "+6281234567890" });
});

describe("who is told (contacts and desk holders)", () => {
  it("contacts: the account e-mail and the profile's WhatsApp number", async () => {
    const contacts = await createSqlContactReader(db()).contacts(["ari", "sekre", "nobody"]);
    expect(Object.fromEntries(contacts)).toEqual({
      ari: { email: "ari@example.org", phone: "+6281234567890" },
      sekre: { email: "sekre@example.org", phone: null },
      nobody: { email: null, phone: null },
    });
  });

  it("holders: active accounts whose custom role holds the permission in the letter's unit", async () => {
    const reader = createSqlContactReader(db());
    expect(await reader.holders("letters.review", { orgUnitPath: ["sekjen"] })).toEqual(["sekre"]);
    expect(
      (await reader.holders("letters.review", { orgUnitPath: ["koor", "media"] })).sort(),
    ).toEqual(["dir", "sekre"]);
    expect(await reader.holders("letters.cancel", { orgUnitPath: [] })).toEqual([]);
    // No active period: period-bound assignments grant nothing, the others still count.
    fake.docs.delete("settings/activePeriod");
    expect(await reader.holders("letters.review", { orgUnitPath: ["sekjen"] })).toEqual(["sekre"]);
  });
});

describe("notification sources (J2)", () => {
  const sent: Array<{ to: string | null; channel: string; key: string; text: string }> = [];
  const logError = vi.fn();
  const notices = (contacts = createSqlContactReader(db())) =>
    createNotices({
      contacts,
      send: (message, key) => {
        sent.push({ to: message.to, channel: message.channel, key, text: message.text });
        return Promise.resolve("sent");
      },
      letterType: (id) =>
        Promise.resolve(id === "missing" ? null : { requiresCoordinator: id === "sk" }),
      webUrl: "https://ppi.example.org",
      adminUrl: "https://admin.ppi.example.org",
      logError,
    });
  beforeEach(() => {
    sent.length = 0;
    logError.mockClear();
  });

  const application = (status: Application["status"], pactNote: string | null = null) =>
    ({
      id: "rec1_ari",
      recruitmentId: "rec1",
      userId: "ari",
      status,
      version: 4,
      pactNote,
    }) as Application;

  it("tells the applicant on WhatsApp, with a link to the application page", async () => {
    await notices().application(application("revision"), "Oprec 2026");
    expect(sent).toEqual([
      {
        to: "+6281234567890",
        channel: "whatsapp",
        key: "recruitment:rec1_ari:revision:4",
        text: expect.stringContaining("https://ppi.example.org/recruitment/rec1") as string,
      },
    ]);
    await notices().application(application("approved", "Tanda tangani halaman 2."), "Oprec");
    expect(sent[1]?.text).toContain("Tanda tangani halaman 2.");
    await notices().application(application("accepted"), "Oprec 2026");
    expect(sent).toHaveLength(2);
  });

  const letter = (fields: Partial<Letter>) =>
    ({
      id: "l1",
      typeId: "su",
      subject: "Undangan",
      orgUnitPath: ["sekjen"],
      createdBy: "ari",
      version: 3,
      secretary: null,
      coordinator: null,
      reviewNote: null,
      ...fields,
    }) as Letter;

  it("letter desks: review → secretariat, passed → each signing desk, approved → issuers", async () => {
    await notices().letter(letter({ status: "review" }));
    expect(sent.map((s) => [s.to, s.key])).toEqual([
      ["sekre@example.org", "letter:l1:review:3:sekre"],
    ]);
    sent.length = 0;
    await notices().letter(letter({ status: "corrected", typeId: "sk" }));
    expect(sent.map((s) => s.to)).toEqual(["rina@example.org", "koor@example.org"]);
    sent.length = 0;
    await notices().letter(letter({ status: "corrected", typeId: "missing" }));
    expect(sent.map((s) => s.to)).toEqual(["rina@example.org"]);
    sent.length = 0;
    // One desk signed: the other was already told when the letter was passed.
    await notices().letter(letter({ status: "corrected", secretary: { uid: "rina", at: now } }));
    expect(sent).toEqual([]);
    await notices().letter(letter({ status: "approved" }));
    expect(sent.map((s) => s.to)).toEqual(["rina@example.org"]);
  });

  it("a returned letter goes back to its author with the note; other steps tell nobody", async () => {
    await notices().letter(letter({ status: "draft", reviewNote: "Fix the date." }));
    expect(sent).toMatchObject([{ to: "+6281234567890", key: "letter:l1:draft:3:ari" }]);
    expect(sent[0]?.text).toContain("Fix the date.");
    await notices().letter(letter({ status: "draft" }));
    await notices().letter(letter({ status: "cancelled" }));
    expect(sent).toHaveLength(1);
  });

  it("LPJ: opened → PICs, submitted → both reviewers, reviewed → approver, back → PICs", async () => {
    const desks: Record<string, string[]> = {
      "lpj.review_secretariat": ["sekre"],
      "lpj.review_treasurer": ["bendahara"],
      "lpj.approve": ["sekjen"],
    };
    const contacts = {
      contacts: (uids: readonly string[]) =>
        Promise.resolve(new Map(uids.map((uid) => [uid, { email: `${uid}@x.org`, phone: null }]))),
      holders: (permission: string) => Promise.resolve(desks[permission] ?? []),
    };
    const signed = { uid: "u", at: now };
    const lpj = (fields: Partial<LpjReport>) =>
      ({
        id: "pr1",
        plan: { name: "Webinar" },
        pics: ["pic"],
        orgUnitPath: ["media"],
        dueOn: "2026-11-18",
        status: "draft",
        version: 1,
        secretariat: null,
        treasurer: null,
        approval: null,
        returnNote: null,
        ...fields,
      }) as LpjReport;
    const run = async (fields: Partial<LpjReport>) => {
      sent.length = 0;
      await notices(contacts).lpj(lpj(fields));
      return sent.map((s) => s.key);
    };
    expect(await run({})).toEqual(["lpj:pr1:draft:1:pic"]);
    expect(sent[0]?.text).toContain("2026-11-18");
    expect(await run({ version: 2 })).toEqual([]);
    expect(await run({ status: "submitted", version: 3 })).toEqual([
      "lpj:pr1:submitted:3:sekre",
      "lpj:pr1:submitted:3:bendahara",
    ]);
    expect(await run({ status: "submitted", version: 4, secretariat: signed })).toEqual([]);
    expect(
      await run({ status: "submitted", version: 5, secretariat: signed, treasurer: signed }),
    ).toEqual(["lpj:pr1:submitted:5:sekjen"]);
    expect(await run({ status: "returned", version: 6, returnNote: "Add receipts" })).toEqual([
      "lpj:pr1:returned:6:pic",
    ]);
    expect(sent[0]?.text).toContain("Add receipts");
    expect(await run({ status: "returned", version: 7 })).toEqual(["lpj:pr1:returned:7:pic"]);
    expect(await run({ status: "approved", version: 8 })).toEqual(["lpj:pr1:approved:8:pic"]);
  });

  const finance = (fields: Partial<FinanceRequest>) =>
    ({
      id: "f1",
      title: "Webinar",
      orgUnitPath: ["media"],
      createdBy: "ari",
      version: 2,
      revisionNote: null,
      rejection: null,
      ...fields,
    }) as FinanceRequest;

  it("finance desks: submitted → treasurer, reviewed → coordinator, authorised → payer", async () => {
    await notices().finance(finance({ status: "submitted" }));
    expect(sent.map((s) => [s.to, s.key])).toEqual([
      ["tina@example.org", "finance:f1:submitted:2:tina"],
    ]);
    await notices().finance(finance({ status: "reviewed" }));
    await notices().finance(finance({ status: "authorized" }));
    expect(sent.map((s) => s.to)).toEqual([
      "tina@example.org",
      "kord@example.org",
      "tina@example.org",
    ]);
  });

  it("finance: returned, rejected and paid requests go to the requester; others tell nobody", async () => {
    await notices().finance(finance({ status: "revision", revisionNote: "Add the RAB." }));
    await notices().finance(
      finance({ status: "rejected", rejection: { uid: "kord", at: now, note: "No budget." } }),
    );
    await notices().finance(finance({ status: "rejected" }));
    await notices().finance(finance({ status: "paid" }));
    await notices().finance(finance({ status: "done" }));
    expect(sent.map((s) => s.key)).toEqual([
      "finance:f1:revision:2:ari",
      "finance:f1:rejected:2:ari",
      "finance:f1:rejected:2:ari",
      "finance:f1:paid:2:ari",
    ]);
    expect(sent[0]?.text).toContain("Add the RAB.");
    expect(sent[1]?.text).toContain("No budget.");
  });

  it("never throws: a failed lookup is logged and the decision stands", async () => {
    const broken = {
      contacts: () => Promise.reject(new Error("db down")),
      holders: () => Promise.reject(new Error("db down")),
    };
    await notices(broken).application(application("interview"), "Oprec");
    await notices(broken).letter(letter({ status: "review" }));
    expect(logError).toHaveBeenCalledWith("notice failed", {
      what: "application",
      id: "rec1_ari",
      error: "Error: db down",
    });
    expect(logError).toHaveBeenCalledTimes(2);
  });
});
