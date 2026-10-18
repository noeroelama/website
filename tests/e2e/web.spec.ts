import { expect, test } from "@playwright/test";

test("web home responds with security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  const html = await response.text();
  // Google's OAuth review fetches "/" as a guest: the purpose and the Google data notice stay.
  expect(html).toContain("Pemberitahuan data Google");
  expect(html).toContain('href="/privacy"');
});

test("public pages are available without signing in", async ({ request }) => {
  for (const [path, title] of [
    // Without a `lang` cookie the site is in Indonesian.
    ["/", "PPIDK Asia-Oseania"],
    ["/articles", "Berita"],
    ["/map", "Peta"],
    ["/events", "Acara"],
    ["/gallery", "Galeri"],
    ["/about", "Tentang kami"],
    ["/terms", "Syarat dan Ketentuan"],
    ["/privacy", "Kebijakan Privasi"],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain(`<h1 class="ui-shell-title">${title}</h1>`);
  }
});

test("sign-in, sign-up and password-reset pages are available", async ({ request }) => {
  for (const [path, text] of [
    ["/login", "Sign in"],
    ["/signup", "Create account"],
    ["/forgot-password", "Reset your password"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html).toContain(text);
    if (path === "/login") expect(html).toContain("Sign in with a passkey");
  }
});

test("the account page requires a session", async ({ request }) => {
  const response = await request.get("/account", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/login");
});

test("the language switch shows English after the lang cookie is set", async ({ request }) => {
  const response = await request.get("/about", { headers: { cookie: "lang=en" } });
  expect(await response.text()).toContain(`<h1 class="ui-shell-title">About us</h1>`);
});
