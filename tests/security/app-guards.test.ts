import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@website/auth";
import { createFirestoreRateLimitStore, getFirestoreForRole } from "@website/db/firestore";
import type * as WebGuardModule from "../../apps/web/src/server/request-guard";

// Staging/production use the shared Firestore store; here it is replaced by a failing fake
// to check the wiring (role, project, fail-open logging) without a real database.
vi.mock("@website/db/firestore", () => ({
  getFirestoreForRole: vi.fn(() => ({})),
  createFirestoreRateLimitStore: vi.fn(() => ({
    consume: () => Promise.reject(new Error("down")),
  })),
}));

// Each Next.js app wires the shared guard in src/server/request-guard.ts (used by src/proxy.ts).
const apps = ["web", "admin", "shop"] as const;
const roles = { web: "web_ro", admin: "admin_rw", shop: "shop_rw" } as const;
type GuardModule = typeof WebGuardModule;
const load = async (app: (typeof apps)[number]) => {
  vi.resetModules();
  return (await import(`../../apps/${app}/src/server/request-guard.ts`)) as GuardModule;
};

afterEach(() => vi.unstubAllEnvs());

describe.each(apps)("%s request guard wiring", (app) => {
  it("blocks cross-site API calls and adds rate-limit headers", async () => {
    vi.stubEnv("APP_ENV", "test");
    const { guardRequest } = await load(app);
    const crossSite = await guardRequest(
      new Request("https://site.example/api/session", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(crossSite.blocked?.status).toBe(403);
    const page = await guardRequest(new Request("https://site.example/"));
    expect(page.blocked).toBeNull();
    expect(page.headers["RateLimit-Limit"]).toBe("100");
  });

  it("staging uses the shared Firestore store with the app's role, and fails open if it is down", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("RATE_LIMIT_SECRET", "s".repeat(32));
    vi.stubEnv("FIREBASE_PROJECT_ID", "ppidk-website-prod");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { guardRequest } = await load(app);
    expect((await guardRequest(new Request("https://site.example/"))).blocked).toBeNull();
    expect(getFirestoreForRole).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appEnv: "staging",
        role: roles[app],
        projectId: "ppidk-website-prod",
      }),
    );
    expect(createFirestoreRateLimitStore).toHaveBeenCalled();
    expect(stdout.mock.calls.join()).toContain("rate_limit_store_error");
    stdout.mockRestore();
  });

  it("refuses to run in production without RATE_LIMIT_SECRET", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    const { guardRequest } = await load(app);
    expect(() => guardRequest(new Request("https://site.example/"))).toThrow(/RATE_LIMIT_SECRET/);
  });

  it("defaults to development under `next dev` when APP_ENV is unset", async () => {
    vi.stubEnv("APP_ENV", undefined);
    vi.stubEnv("NODE_ENV", "development");
    const { guardRequest } = await load(app);
    expect((await guardRequest(new Request("https://site.example/"))).blocked).toBeNull();
  });
});

// With Cache Components a page's redirect() is streamed (200 + client-side redirect), so each
// proxy sends signed-out visitors of login-required pages to sign-in itself, with a real 307.
describe("sign-in redirect before the page renders (proxy)", () => {
  const signedIn = { headers: { cookie: `theme=dark; ${SESSION_COOKIE}=token` } };

  it("web sends a visitor without a session cookie from /account to /login", async () => {
    vi.stubEnv("APP_ENV", "test");
    const { signInRedirect } = await load("web");
    expect(signInRedirect(new Request("https://site.example/account?tab=keys"))).toBe(
      `/login?next=${encodeURIComponent("/account?tab=keys")}`,
    );
    expect(signInRedirect(new Request("https://site.example/account/passkeys"))).toBe(
      `/login?next=${encodeURIComponent("/account/passkeys")}`,
    );
    expect(signInRedirect(new Request("https://site.example/account", signedIn))).toBeNull();
    for (const path of ["/", "/accounts", "/login", "/api/session"]) {
      expect(signInRedirect(new Request(`https://site.example${path}`)), path).toBeNull();
    }
  });

  it("admin sends a visitor without a session cookie from any page to the web sign-in", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("WEB_URL", "https://web.example");
    vi.stubEnv("ADMIN_URL", "https://admin.example");
    const { signInRedirect } = await load("admin");
    expect(signInRedirect(new Request("https://admin.example/events?page=2"))).toBe(
      `https://web.example/login?next=${encodeURIComponent("https://admin.example/events?page=2")}`,
    );
    expect(signInRedirect(new Request("https://admin.example/events", signedIn))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/api/session"))).toBeNull();
  });

  it("admin leaves signed-out visitors to the page when WEB_URL/ADMIN_URL are not set", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("WEB_URL", "");
    vi.stubEnv("ADMIN_URL", "");
    const { signInRedirect } = await load("admin");
    expect(signInRedirect(new Request("https://admin.example/events"))).toBeNull();
  });
});
