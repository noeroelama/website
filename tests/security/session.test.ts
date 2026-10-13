import { describe, expect, it, vi } from "vitest";
import { createSessionRoutes, SESSION_COOKIE, type IdentityProvider } from "@website/auth";

function provider(over: Partial<IdentityProvider> = {}) {
  const mocks = {
    createSessionCookie: vi.fn((_token: string, _maxAgeMs: number) =>
      Promise.resolve("session-cookie-value"),
    ),
    verifySessionCookie: vi.fn((_cookie: string) =>
      Promise.resolve({
        uid: "u1",
        email: null,
        emailVerified: true,
        signInProvider: "google.com",
        authTime: 0,
      }),
    ),
    revokeSessions: vi.fn((_uid: string) => Promise.resolve()),
    createCustomToken: vi.fn((_uid: string) => Promise.resolve("custom-token")),
  };
  const identity: IdentityProvider = { ...mocks, ...over };
  return { identity, mocks };
}
const post = (body: unknown) =>
  new Request("https://web.example.org/api/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("OAuth session endpoint (Google sign-in via Firebase → server session cookie)", () => {
  it("exchanges a verified ID token for a hardened session cookie", async () => {
    const { identity, mocks } = provider();
    const res = await createSessionRoutes({ identity, maxAgeHours: 8 }).POST(
      post({ idToken: "google-id-token" }),
    );
    expect(res.status).toBe(204);
    expect(mocks.createSessionCookie).toHaveBeenCalledWith("google-id-token", 8 * 3600 * 1000);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=session-cookie-value`);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=28800"])
      expect(cookie).toContain(attr);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("uses a __Secure- cookie so one session can be shared by web, admin and shop", () => {
    // __Host- forbids the Domain attribute; __Secure- still forces Secure.
    expect(SESSION_COOKIE).toBe("__Secure-session");
  });

  it("sets and clears the shared cookie on the configured parent domain", async () => {
    const { identity } = provider();
    const routes = createSessionRoutes({ identity, maxAgeHours: 8, cookieDomain: "ppiasiania.id" });
    const signIn = await routes.POST(post({ idToken: "google-id-token" }));
    expect(signIn.headers.get("set-cookie")).toContain("Domain=ppiasiania.id");
    const signOut = await routes.DELETE(
      new Request("https://admin.ppiasiania.id/api/session", { method: "DELETE" }),
    );
    // A cookie set with a Domain can only be cleared with the same Domain.
    expect(signOut.headers.get("set-cookie")).toContain("Domain=ppiasiania.id");
    expect(signOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed bodies and any attempt to choose a uid or role", async () => {
    const routes = createSessionRoutes({ identity: provider().identity, maxAgeHours: 8 });
    for (const body of [
      {},
      { idToken: "" },
      { idToken: "t", uid: "victim" },
      { idToken: "t", role: "superadmin" },
      "x",
    ]) {
      expect((await routes.POST(post(body))).status, JSON.stringify(body)).toBe(400);
    }
    const notJson = new Request("https://web.example.org/api/session", {
      method: "POST",
      body: "{",
    });
    expect((await routes.POST(notJson)).status).toBe(400);
  });

  it("returns a generic 401 when the token is invalid, without leaking the reason", async () => {
    const { identity } = provider({
      createSessionCookie: () => Promise.reject(new Error("Firebase ID token has expired at 123")),
    });
    const res = await createSessionRoutes({ identity, maxAgeHours: 8 }).POST(
      post({ idToken: "expired" }),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("expired");
  });

  it("sign-out revokes the user's sessions and clears the cookie", async () => {
    const { identity, mocks } = provider();
    const signOut = new Request("https://web.example.org/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=abc` },
    });
    const res = await createSessionRoutes({ identity, maxAgeHours: 8 }).DELETE(signOut);
    expect(res.status).toBe(204);
    expect(mocks.revokeSessions).toHaveBeenCalledWith("u1");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("sign-out without (or with an invalid) session still clears the cookie", async () => {
    const { identity, mocks } = provider({ verifySessionCookie: () => Promise.resolve(null) });
    const routes = createSessionRoutes({ identity, maxAgeHours: 8 });
    const bare = await routes.DELETE(
      new Request("https://web.example.org/api/session", { method: "DELETE" }),
    );
    expect(bare.status).toBe(204);
    const invalid = await routes.DELETE(
      new Request("https://web.example.org/api/session", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE}=bad` },
      }),
    );
    expect(invalid.status).toBe(204);
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });
});
