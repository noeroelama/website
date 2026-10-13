import { expect, test } from "@playwright/test";

test("admin home responds with security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  expect(await response.text()).toContain("admin: ok");
});

test("admin is not signed in without a verified session", async ({ request }) => {
  const response = await request.get("/", { headers: { cookie: "role=superadmin" } });
  expect(await response.text()).toContain("sign-in required");
});

test("every side-panel page requires a verified session", async ({ request }) => {
  for (const path of [
    "/tools",
    "/events",
    "/gallery",
    "/articles",
    "/newsletter",
    "/organizations",
    "/audit",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    // E2E runs without WEB_URL/ADMIN_URL, so the page shows the message instead of redirecting.
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain("sign-in required");
  }
});
