import { expect, test } from "@playwright/test";

// Runs against every app (see playwright.config.ts): request-level checks, no browser needed.
test("HTTPS-only (HSTS) and rate-limit headers on every app", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["strict-transport-security"]).toMatch(/max-age=\d+/);
  expect(response.headers()["ratelimit-limit"]).toBe("100");
});

test("internal APIs refuse requests from other websites and non-browser clients", async ({
  request,
  baseURL,
}) => {
  test.skip(
    baseURL?.endsWith(":3003") ?? false,
    "gateway is the public API (covered by integration tests)",
  );
  const crossSite = await request.post("/api/session", {
    headers: { origin: "https://evil.example" },
    data: { idToken: "x" },
  });
  expect(crossSite.status()).toBe(403);
  expect(await crossSite.json()).toEqual({ error: "forbidden", message: "Request not allowed." });
  expect((await request.get("/api/session")).status()).toBe(403);
});

test("unknown pages show the generic 404 page", async ({ request, baseURL }) => {
  test.skip(
    baseURL?.endsWith(":3003") ?? false,
    "gateway returns RFC 9457 problems (covered by integration tests)",
  );
  const response = await request.get("/this-page-does-not-exist");
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("Page not found");
});
