import { expect, test } from "@playwright/test";

test("web home responds with security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  const html = await response.text();
  expect(html).toContain("Pemberitahuan data Google");
  expect(html).toContain('href="/privacy"');
});

test("public pages are available without signing in", async ({ request }) => {
  for (const [path, title] of [
    ["/", "Menyatukan Pelajar Indonesia"],
    ["/news", "Blog &amp; Artikel"],
    ["/map", "Peta PPI Negara"],
    ["/events", "Acara"],
    ["/activities", "Kegiatan"],
    ["/gallery", "Galeri Kami"],
    ["/about", "Tentang kami"],
    ["/terms", "Syarat dan Ketentuan"],
    ["/privacy", "Kebijakan Privasi"],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain(title);
  }
});

const part = (html: string, tag: string) =>
  html.slice(html.indexOf(`<${tag}`), html.indexOf(`</${tag}>`));
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);

test("every public page has the site header and footer", async ({ request }) => {
  const html = await (await request.get("/gallery")).text();

  const header = part(html, "header");
  expect(header).toContain('src="/logo.webp"');
  expect(links(header)).toEqual(["/", "/about", "/events", "/gallery", "/news", "/map", "/login"]);
  expect(header).toContain('href="/gallery" aria-current="page"');

  const footer = part(html, "footer");
  expect(footer).toContain('src="/logo.webp"');
  for (const text of ["Jelajahi", "Komunitas Kami", "Alamat", "PPI Tiongkok", "Kirai 07"]) {
    expect(footer).toContain(text);
  }
  expect(links(footer)).toEqual(
    expect.arrayContaining(["/", "/about", "/events", "/gallery", "/news", "/map", "/terms"]),
  );
  expect(links(footer)).toContain("/privacy");
  expect(footer.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(5);
  expect(footer).not.toContain('type="email"');
});

test("old /articles links go to /news; unknown articles show the 404 page", async ({ request }) => {
  const moved = await request.get("/articles", { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers()["location"]).toBe("/news");
  for (const path of ["/news/Not A Slug", "/events/Not A Slug", "/gallery/Not A Slug"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("Page not found");
    expect(html, path).toContain('<meta name="robots" content="noindex"/>');
  }
});

test("newsletter: the field is on Home; links do nothing until a button is pressed", async ({
  request,
}) => {
  expect(await (await request.get("/")).text()).toContain('type="email"');
  const confirm = await (await request.get("/newsletter/confirm")).text();
  expect(confirm).toContain("Tautan ini tidak berlaku.");
  const unsubscribe = await (await request.get("/newsletter/unsubscribe?t=abc")).text();
  expect(unsubscribe).toContain("Berhenti berlangganan");
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
  expect(await response.text()).toContain("About us");
});

test("unknown public form links show the 404 page", async ({ request }) => {
  for (const path of ["/f/unknownToken000000000000", "/f/not-a-token"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("Page not found");
  }
});

test("document verification: the code page needs no sign-in and is never indexed", async ({
  request,
}) => {
  const response = await request.get("/verify");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Verifikasi Dokumen");
  expect(html).toContain('name="robots" content="noindex, nofollow"');
  const bad = await (await request.get("/verify?code=not-a-code")).text();
  expect(bad).toContain("8F3KM-QRTVW");
});
