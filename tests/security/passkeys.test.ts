import { describe, expect, it, vi } from "vitest";
import {
  createPasskeyRoutes,
  PASSKEY_CHALLENGE_COOKIE,
  SESSION_COOKIE,
  type IdentityProvider,
  type PasskeyStore,
} from "@website/auth";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { createSoftwareAuthenticator } from "../support/software-authenticator";

const ORIGIN = "https://web.example.org";
const NOW = new Date("2026-10-07T10:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

function setup(options: { authTime?: number; store?: PasskeyStore; realClock?: boolean } = {}) {
  const store = options.store ?? createMemoryPasskeyStore();
  const createCustomToken = vi.fn((uid: string) => Promise.resolve(`custom-token-for-${uid}`));
  const identity: IdentityProvider = {
    createSessionCookie: () => Promise.resolve("unused"),
    verifySessionCookie: (cookie) =>
      Promise.resolve(
        cookie === "bob-session"
          ? {
              uid: "bob",
              email: null,
              emailVerified: false,
              signInProvider: "custom",
              authTime: nowSeconds - 60,
            }
          : cookie === "alice-session"
            ? {
                uid: "alice",
                email: "alice@example.org",
                emailVerified: true,
                signInProvider: "password",
                authTime: options.authTime ?? nowSeconds - 60,
              }
            : null,
      ),
    revokeSessions: () => Promise.resolve(),
    createCustomToken,
  };
  let clock = NOW;
  const routes = createPasskeyRoutes({
    store,
    identity,
    rpName: "PPIDK Asia-Oseania",
    origin: ORIGIN,
    ...(options.realClock ? {} : { now: () => clock }),
  });
  return {
    routes,
    store,
    createCustomToken,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

const post = (body: unknown, cookies: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/passkeys/x`, {
    method: "POST",
    body: body === undefined ? null : JSON.stringify(body),
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });

function challengeCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${PASSKEY_CHALLENGE_COOKIE}=([^;]*)`).exec(header);
  return match?.[1] ?? "";
}

async function registerPasskey(ctx: ReturnType<typeof setup>) {
  const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
  const optionsRes = await ctx.routes.registerOptions(
    post(undefined, { [SESSION_COOKIE]: "alice-session" }),
  );
  const options = (await optionsRes.json()) as { challenge: string };
  const res = await ctx.routes.registerVerify(
    post(authenticator.register(options.challenge), {
      [SESSION_COOKIE]: "alice-session",
      [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
    }),
  );
  return { authenticator, res };
}

async function startLogin(ctx: ReturnType<typeof setup>) {
  const res = await ctx.routes.loginOptions(post(undefined));
  const options = (await res.json()) as {
    challenge: string;
    rpId: string;
    userVerification: string;
  };
  return { options, cookie: challengeCookie(res) };
}

describe("passkey registration", () => {
  it("requires a signed-in user", async () => {
    const { routes } = setup();
    expect((await routes.registerOptions(post(undefined))).status).toBe(401);
    expect(
      (await routes.registerOptions(post(undefined, { [SESSION_COOKIE]: "forged" }))).status,
    ).toBe(401);
  });

  it("requires a recent sign-in (adding a credential is sensitive)", async () => {
    const { routes } = setup({ authTime: nowSeconds - 60 * 60 });
    expect(
      (await routes.registerOptions(post(undefined, { [SESSION_COOKIE]: "alice-session" }))).status,
    ).toBe(401);
  });

  it("issues options for this site with user verification and a short-lived, HttpOnly challenge cookie", async () => {
    const { routes } = setup();
    const res = await routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "alice-session" }),
    );
    expect(res.status).toBe(200);
    const options = (await res.json()) as {
      rp: { id: string };
      authenticatorSelection: Record<string, string>;
    };
    expect(options.rp.id).toBe("web.example.org");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=300", "Path=/"])
      expect(cookie).toContain(attr);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("verifies and stores a real credential", async () => {
    const ctx = setup();
    const { authenticator, res } = await registerPasskey(ctx);
    expect(res.status).toBe(204);
    const stored = await ctx.store.findById(authenticator.id);
    expect(stored).toMatchObject({
      id: authenticator.id,
      userId: "alice",
      counter: 0,
      transports: ["internal"],
    });
  });

  it("excludes credentials the user already has", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const res = await ctx.routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "alice-session" }),
    );
    const options = (await res.json()) as { excludeCredentials: Array<{ id: string }> };
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([authenticator.id]);
  });

  it("rejects a response for another website (phishing) and malformed bodies", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
    for (const make of [
      (challenge: string) => authenticator.register(challenge, { origin: "https://evil.example" }),
      () => ({ id: "x" }),
      () => "not-an-object",
    ]) {
      const optionsRes = await ctx.routes.registerOptions(
        post(undefined, { [SESSION_COOKIE]: "alice-session" }),
      );
      const { challenge } = (await optionsRes.json()) as { challenge: string };
      const res = await ctx.routes.registerVerify(
        post(make(challenge), {
          [SESSION_COOKIE]: "alice-session",
          [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(await ctx.store.listByUser("alice")).toEqual([]);
  });

  it("rejects verification without a session or without a valid challenge", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "alice");
    expect((await ctx.routes.registerVerify(post(authenticator.register("x")))).status).toBe(401);
    const res = await ctx.routes.registerVerify(
      post(authenticator.register("x"), {
        [SESSION_COOKIE]: "alice-session",
        [PASSKEY_CHALLENGE_COOKIE]: "unknown",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("passkey sign-in", () => {
  it("signs the user in: a verified assertion yields a Firebase custom token for that user", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    expect(options).toMatchObject({ rpId: "web.example.org", userVerification: "required" });
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ customToken: "custom-token-for-alice" });
    expect(ctx.createCustomToken).toHaveBeenCalledWith("alice");
    expect((await ctx.store.findById(authenticator.id))?.counter).toBe(1);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("a challenge can be used only once, even by concurrent requests (no replay, no race)", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    const assertion = authenticator.authenticate(options.challenge);
    const results = await Promise.all([
      ctx.routes.loginVerify(post(assertion, { [PASSKEY_CHALLENGE_COOKIE]: cookie })),
      ctx.routes.loginVerify(post(assertion, { [PASSKEY_CHALLENGE_COOKIE]: cookie })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("rejects expired challenges", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    ctx.advance(5 * 60 * 1000 + 1);
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown credentials, other websites, wrong user handles and cloned authenticators", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    const stranger = createSoftwareAuthenticator(ORIGIN, "mallory");
    const attempts = [
      (c: string) => stranger.authenticate(c),
      (c: string) => authenticator.authenticate(c, { origin: "https://evil.example" }),
      (c: string) => authenticator.authenticate(c, { userHandle: "bWFsbG9yeQ" }),
      (c: string) => authenticator.authenticate(c, { counter: 5 }),
      (c: string) => authenticator.authenticate(c, { counter: 3 }),
      () => ({ id: authenticator.id }),
    ];
    const statuses: number[] = [];
    for (const attempt of attempts) {
      const { options, cookie } = await startLogin(ctx);
      const res = await ctx.routes.loginVerify(
        post(attempt(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
      );
      statuses.push(res.status);
      if (res.status !== 200)
        expect(await res.json()).toEqual({
          error: "unauthenticated",
          message: "Sign-in required.",
        });
    }
    expect(statuses).toEqual([401, 401, 401, 200, 401, 401]);
  });

  it("rejects sign-in without a challenge cookie", async () => {
    const ctx = setup();
    const { authenticator } = await registerPasskey(ctx);
    expect((await ctx.routes.loginVerify(post(authenticator.authenticate("abc")))).status).toBe(
      401,
    );
  });
});

describe("passkey edge cases", () => {
  it("accounts without an email use the uid as the passkey name; missing transports are stored as []", async () => {
    const ctx = setup();
    const authenticator = createSoftwareAuthenticator(ORIGIN, "bob");
    const optionsRes = await ctx.routes.registerOptions(
      post(undefined, { [SESSION_COOKIE]: "bob-session" }),
    );
    const options = (await optionsRes.json()) as { challenge: string; user: { name: string } };
    expect(options.user.name).toBe("bob");
    const response = authenticator.register(options.challenge);
    const withoutTransports = {
      clientDataJSON: response.response.clientDataJSON,
      attestationObject: response.response.attestationObject,
    };
    const res = await ctx.routes.registerVerify(
      post(
        { ...response, response: withoutTransports },
        {
          [SESSION_COOKIE]: "bob-session",
          [PASSKEY_CHALLENGE_COOKIE]: challengeCookie(optionsRes),
        },
      ),
    );
    expect(res.status).toBe(204);
    expect((await ctx.store.findById(authenticator.id))?.transports).toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    const ctx = setup();
    const { cookie } = await startLogin(ctx);
    const res = await ctx.routes.loginVerify(
      new Request(`${ORIGIN}/api/passkeys/x`, {
        method: "POST",
        body: "{not json",
        headers: { cookie: `${PASSKEY_CHALLENGE_COOKIE}=${cookie}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("denies when a concurrent sign-in already used the same authenticator state (atomic counter)", async () => {
    const memory = createMemoryPasskeyStore();
    const ctx = setup({ store: { ...memory, recordUse: () => Promise.resolve(false) } });
    const { authenticator } = await registerPasskey(ctx);
    const { options, cookie } = await startLogin(ctx);
    const res = await ctx.routes.loginVerify(
      post(authenticator.authenticate(options.challenge), { [PASSKEY_CHALLENGE_COOKIE]: cookie }),
    );
    expect(res.status).toBe(401);
    expect(ctx.createCustomToken).not.toHaveBeenCalled();
  });

  it("uses the real clock by default", async () => {
    const ctx = setup({ realClock: true });
    const { options, cookie } = await startLogin(ctx);
    expect(options.challenge).toBeTruthy();
    expect(cookie).toBeTruthy();
  });
});
