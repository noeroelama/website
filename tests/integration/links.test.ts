import { beforeEach, describe, expect, it } from "vitest";
import { createSqlShortLinkStore } from "@website/db/sql";
import { ShortenerError, type Shortener } from "@website/domain/links";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createLinkActions } from "../../apps/admin/src/server/links";
import { goppiShortener, sidShortener } from "../../apps/admin/src/server/shorteners";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlShortLinkStore>[0];
const now = new Date("2026-11-05T03:00:00Z");
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
const editor = staff(["tools.edit"]);

/** A fake provider HTTP API: records calls, answers from a script. */
function api(answers: Array<{ status: number; body?: unknown } | "network">) {
  const calls: Array<{ url: string; method: string; body: unknown; auth: string }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method as string,
      body: init.body ? (JSON.parse(init.body as string) as unknown) : null,
      auth: (init.headers as Record<string, string>)["Authorization"] as string,
    });
    const next = answers.shift() ?? { status: 200, body: {} };
    if (next === "network") return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(
      new Response(next.body === undefined ? "not json" : JSON.stringify(next.body), {
        status: next.status,
      }),
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("goppi.id adapter (primary)", () => {
  it("creates with long_url, slug, title and archives by id", async () => {
    const http = api([
      {
        status: 201,
        body: { data: { id: 42, slug: "kongres", short_url: "https://goppi.id/kongres" } },
      },
      { status: 200, body: {} },
    ]);
    const goppi = goppiShortener(
      { baseUrl: "https://goppi.id/api/", apiKey: "g-key" },
      http.fetchImpl,
    );
    expect(await goppi.available("kongres")).toBeNull();
    expect(
      await goppi.create({ longUrl: "https://example.org/a", slug: "kongres", title: "Kongres" }),
    ).toEqual({ ref: "42", slug: "kongres", shortUrl: "https://goppi.id/kongres" });
    await goppi.archive("42");
    expect(http.calls).toEqual([
      {
        url: "https://goppi.id/api/links",
        method: "POST",
        body: { long_url: "https://example.org/a", title: "Kongres", slug: "kongres" },
        auth: "Bearer g-key",
      },
      {
        url: "https://goppi.id/api/links/42/archive",
        method: "PUT",
        body: null,
        auth: "Bearer g-key",
      },
    ]);
    await expect(goppi.restore("42")).rejects.toMatchObject({ reason: "not_supported" });
    expect(await goppi.clicks("42")).toBeNull();
  });

  it("maps answers: 409 taken, 4xx invalid, 5xx / network / no config unavailable", async () => {
    const make = (answer: { status: number; body?: unknown } | "network") =>
      goppiShortener(
        { baseUrl: "https://goppi.id/api", apiKey: "k" },
        api([answer]).fetchImpl,
      ).create({
        longUrl: "https://example.org",
        slug: null,
        title: "",
      });
    await expect(make({ status: 409, body: { error: "slug_taken" } })).rejects.toMatchObject({
      reason: "slug_taken",
    });
    await expect(make({ status: 422 })).rejects.toMatchObject({ reason: "invalid" });
    await expect(make({ status: 503 })).rejects.toMatchObject({ reason: "unavailable" });
    await expect(make("network")).rejects.toMatchObject({ reason: "unavailable" });
    await expect(make({ status: 200, body: { id: 1 } })).rejects.toMatchObject({
      reason: "unavailable",
    });
    await expect(make({ status: 200 })).rejects.toMatchObject({ reason: "unavailable" });
    await expect(make({ status: 200, body: 5 })).rejects.toMatchObject({ reason: "unavailable" });
    await expect(make({ status: 200, body: { id: 7, slug: "x7" } })).resolves.toEqual({
      ref: "7",
      slug: "x7",
      shortUrl: "https://goppi.id/x7",
    });
    await expect(
      goppiShortener(null, api([]).fetchImpl).create({
        longUrl: "https://example.org",
        slug: null,
        title: "",
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("s.id adapter (fallback)", () => {
  it("uses custom_slug, DELETE to archive, POST unarchive, stats and availability", async () => {
    const http = api([
      { status: 200, body: { data: { available: true } } },
      { status: 201, body: { data: { short: "kongres" } } },
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: { data: { clicks: 12 } } },
      { status: 200, body: { data: {} } },
      { status: 200, body: { data: { available: false } } },
    ]);
    const sid = sidShortener("s-key", http.fetchImpl);
    expect(await sid.available("kongres")).toBe(true);
    expect(
      await sid.create({ longUrl: "https://example.org/a", slug: "kongres", title: "K" }),
    ).toEqual({
      ref: "kongres",
      slug: "kongres",
      shortUrl: "https://s.id/kongres",
    });
    await sid.archive("kongres");
    await sid.restore("kongres");
    expect(await sid.clicks("kongres")).toBe(12);
    expect(await sid.clicks("kongres")).toBeNull();
    expect(await sid.available("other")).toBe(false);
    expect(http.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "https://api.s.id/v2/links/available", { custom_slug: "kongres" }],
      [
        "POST",
        "https://api.s.id/v2/links",
        { long_url: "https://example.org/a", title: "K", custom_slug: "kongres" },
      ],
      ["DELETE", "https://api.s.id/v2/links/kongres", null],
      ["POST", "https://api.s.id/v2/links/kongres/unarchive", null],
      ["GET", "https://api.s.id/v2/links/kongres/stats", null],
      ["GET", "https://api.s.id/v2/links/kongres/stats", null],
      ["POST", "https://api.s.id/v2/links/available", { custom_slug: "other" }],
    ]);
    const random = sidShortener(
      "k",
      api([{ status: 201, body: { short: "Ab12", short_url: "https://s.id/Ab12" } }]).fetchImpl,
    );
    expect(
      await random.create({ longUrl: "https://example.org", slug: null, title: "" }),
    ).toMatchObject({
      ref: "Ab12",
    });
    await expect(
      sidShortener("k", api([{ status: 201, body: {} }]).fetchImpl).create({
        longUrl: "https://example.org",
        slug: null,
        title: "",
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    await expect(sidShortener(null, api([]).fetchImpl).available("x")).rejects.toBeInstanceOf(
      ShortenerError,
    );
  });
});

describe("short links (K1)", () => {
  let fake: ReturnType<typeof fakeDb>;
  let errors: string[];
  const fakeProvider = (
    provider: "goppi" | "sid",
    behaviour: { available?: boolean | null; fail?: "slug_taken" | "invalid" | "unavailable" } = {},
  ): Shortener & { created: string[] } => {
    const created: string[] = [];
    return {
      provider,
      created,
      available: () => Promise.resolve(behaviour.available ?? null),
      create: (input) => {
        if (behaviour.fail) return Promise.reject(new ShortenerError(behaviour.fail));
        const slug = input.slug ?? "auto1";
        created.push(slug);
        return Promise.resolve({
          ref: `${provider}-${slug}`,
          slug,
          shortUrl: `https://${provider}.example/${slug}`,
        });
      },
      archive: () => Promise.resolve(),
      restore: () =>
        provider === "sid"
          ? Promise.resolve()
          : Promise.reject(new ShortenerError("not_supported")),
      clicks: () => Promise.resolve(5),
    };
  };
  const actions = (shorteners: Shortener[]) =>
    createLinkActions({
      shorteners,
      links: createSqlShortLinkStore(fake.db as unknown as Db),
      logError: (message) => errors.push(message),
      now: () => now,
    });
  const input = { longUrl: "https://example.org/long", title: "Kongres", slug: "kongres" };

  beforeEach(() => {
    fake = fakeDb();
    errors = [];
  });

  it("goppi.id first; s.id only when goppi.id is unreachable", async () => {
    const goppi = fakeProvider("goppi", { fail: "unavailable" });
    const sid = fakeProvider("sid", { available: true });
    const result = await actions([goppi, sid]).create(...as(editor))(input);
    expect(result).toMatchObject({
      ok: true,
      data: { provider: "sid", shortUrl: "https://sid.example/kongres" },
    });
    const links = await createSqlShortLinkStore(fake.db as unknown as Db).list();
    expect(links).toMatchObject([
      { provider: "sid", ref: "sid-kongres", source: "tools", createdBy: "staff" },
    ]);
    const again = await actions([
      fakeProvider("goppi", { fail: "unavailable" }),
      fakeProvider("sid"),
    ]).create(...as(editor))(input);
    expect(again).toMatchObject({ ok: false, issues: ["This short URL is already recorded."] });
  });

  it("checks a chosen slug first; taken or refused stops there (no silent fallback)", async () => {
    const sid = fakeProvider("sid");
    const taken = await actions([fakeProvider("goppi", { available: false }), sid]).create(
      ...as(editor),
    )(input);
    expect(taken).toMatchObject({
      ok: false,
      issues: ["This short URL is already taken. Choose another one."],
    });
    expect(sid.created).toEqual([]);
    const refused = await actions([fakeProvider("goppi", { fail: "invalid" }), sid]).create(
      ...as(editor),
    )(input);
    expect(refused).toMatchObject({
      issues: [expect.stringContaining("refused this link")] as unknown,
    });
    const down = await actions([fakeProvider("goppi", { fail: "unavailable" })]).create(
      ...as(editor),
    )(input);
    expect(down).toMatchObject({
      issues: ["The short-link services are not reachable now. Try again later."],
    });
    const bad = await actions([sid]).create(...as(editor))({ ...input, slug: "a b" });
    expect(bad).toMatchObject({ error: "invalid_input" });
    const reader = await actions([sid]).create(...as(staff(["tools.read"])))(input);
    expect(reader).toMatchObject({ error: "forbidden" });
  });

  it("archive, restore, rename and clicks", async () => {
    const goppi = fakeProvider("goppi");
    const created = await actions([goppi]).create(...as(editor))({ ...input, slug: null });
    if (!created.ok) throw new Error("create failed");
    const { id } = created.data;
    const archived = await actions([goppi]).setArchived(...as(editor))({
      id,
      version: 1,
      archived: true,
    });
    expect(archived).toMatchObject({ ok: true, data: { archived: true } });
    const restore = await actions([goppi]).setArchived(...as(editor))({
      id,
      version: 2,
      archived: false,
    });
    expect(restore).toMatchObject({ issues: ["This action is not available for this provider."] });
    const renamed = await actions([goppi]).rename(...as(editor))({ id, version: 2, title: "New" });
    expect(renamed).toMatchObject({ ok: true, data: { title: "New", archived: true } });
    expect(await actions([goppi]).clicks(...as(staff(["tools.read"])))({ id })).toEqual({
      ok: true,
      data: { clicks: 5 },
    });
    expect(await actions([]).clicks(...as(editor))({ id })).toMatchObject({
      issues: ["This provider is not set up any more."],
    });
    expect(await actions([goppi]).clicks(...as(editor))({ id: "ghost" })).toMatchObject({
      issues: ["This link does not exist."],
    });
    expect(
      await actions([goppi]).setArchived(...as(editor))({
        id: "ghost",
        version: 1,
        archived: true,
      }),
    ).toMatchObject({ issues: ["This link does not exist."] });

    const sid = fakeProvider("sid");
    const viaSid = await actions([sid]).create(...as(editor))({ ...input, slug: "via-sid" });
    if (!viaSid.ok) throw new Error("create failed");
    await actions([sid]).setArchived(...as(editor))({
      id: viaSid.data.id,
      version: 1,
      archived: true,
    });
    const back = await actions([sid]).setArchived(...as(editor))({
      id: viaSid.data.id,
      version: 2,
      archived: false,
    });
    expect(back).toMatchObject({ ok: true, data: { archived: false } });
    const broken: Shortener = { ...sid, create: () => Promise.reject(new Error("bug")) };
    await expect(actions([broken]).create(...as(editor))(input)).rejects.toThrow("bug");
  });

  it("silent mode: the short URL, or the long URL when nothing works (logged)", async () => {
    const ok = await actions([fakeProvider("goppi")]).shorten(
      "https://zoom.us/j/1",
      "Zoom",
      "zoom",
    );
    expect(ok).toBe("https://goppi.example/auto1");
    const links = await createSqlShortLinkStore(fake.db as unknown as Db).list();
    expect(links[0]).toMatchObject({ source: "zoom", createdBy: null });
    const failed = await actions([fakeProvider("goppi", { fail: "invalid" })]).shorten(
      "https://zoom.us/j/2",
      "Zoom",
      "zoom",
    );
    expect(failed).toBe("https://zoom.us/j/2");
    expect(errors).toEqual(["short link failed"]);
  });
});
