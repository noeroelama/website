import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskFileStorage, fileContentType } from "@website/db/sql";
import { signLink } from "@website/security";
import { createFileRoutes } from "../../apps/web/src/server/files";

const secret = "s".repeat(32);
const now = new Date("2026-10-31T10:00:00Z");

describe("files on the cPanel disk", () => {
  let root: string;
  let storage: ReturnType<typeof createDiskFileStorage>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "files-"));
    storage = createDiskFileStorage({
      root,
      baseUrl: "https://web.example",
      secret,
      now: () => now,
    });
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("stores public files under public/ with a long-cached URL, private ones without a URL", async () => {
    const pub = await storage.save("galleries/a.webp", new Uint8Array([1, 2]), {
      visibility: "public",
    });
    expect(pub.url).toBe("https://web.example/files/galleries/a.webp");
    expect([...(await readFile(join(root, "public/galleries/a.webp")))]).toEqual([1, 2]);

    const priv = await storage.save("members/ktm/k.webp", new Uint8Array([3]), {
      visibility: "private",
    });
    expect(priv.url).toBeNull();
    expect([...((await storage.read("members/ktm/k.webp")) ?? [])]).toEqual([3]);
    expect([...((await storage.read("galleries/a.webp")) ?? [])]).toEqual([1, 2]);
    expect(await storage.read("members/ktm/k.webp", "public")).toBeNull();
    expect(await storage.read("missing.pdf")).toBeNull();

    await storage.remove("members/ktm/k.webp");
    await storage.remove("members/ktm/k.webp"); // missing is not an error
    expect(await storage.read("members/ktm/k.webp")).toBeNull();
  });

  it("refuses paths that could leave the storage folder", async () => {
    for (const bad of ["../x.pdf", "a/../../x.pdf", "/etc/passwd", "a//b.pdf", "a\\b.pdf", ""]) {
      await expect(storage.save(bad, new Uint8Array(), { visibility: "public" })).rejects.toThrow(
        "Invalid file path",
      );
      await expect(storage.read(bad)).rejects.toThrow("Invalid file path");
    }
  });

  it("serves public files, and private files only with an unexpired signed link", async () => {
    await storage.save("galleries/a.webp", new Uint8Array([1]), { visibility: "public" });
    await storage.save("recruitment/p.pdf", new Uint8Array([2]), {
      visibility: "private",
      contentType: "application/pdf",
    });
    let clock = now;
    const routes = createFileRoutes({
      storage: () => storage,
      secret: () => secret,
      now: () => clock,
    });

    const pub = await routes.publicFile(["galleries", "a.webp"]);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("content-type")).toBe("image/webp");
    expect(pub.headers.get("cache-control")).toContain("immutable");
    expect((await routes.publicFile(["recruitment", "p.pdf"])).status).toBe(404);
    expect((await routes.publicFile(["..", "x"])).status).toBe(404);

    const url = new URL(await storage.signedReadUrl("recruitment/p.pdf"));
    expect(url.pathname).toBe("/private-files");
    const token = url.searchParams.get("t");
    const priv = await routes.privateFile(token);
    expect(priv.status).toBe(200);
    expect(priv.headers.get("content-type")).toBe("application/pdf");
    expect(priv.headers.get("cache-control")).toBe("private, no-store");
    expect([...new Uint8Array(await priv.arrayBuffer())]).toEqual([2]);

    expect((await routes.privateFile(null)).status).toBe(404);
    // Other signed links (unsubscribe, certificate pickup) never open files.
    expect((await routes.privateFile(signLink({ path: "recruitment/p.pdf" }, secret))).status).toBe(
      404,
    );
    const traversal = signLink({ purpose: "file", path: "../x.pdf" }, secret);
    expect((await routes.privateFile(traversal)).status).toBe(404);
    const noSecret = createFileRoutes({
      storage: () => storage,
      secret: () => undefined,
      now: () => clock,
    });
    expect((await noSecret.privateFile(token)).status).toBe(404);
    expect(
      (await routes.privateFile(signLink({ purpose: "file", path: "gone.pdf" }, secret))).status,
    ).toBe(404);
    expect((await routes.privateFile(`${token}x`)).status).toBe(404);
    clock = new Date(now.getTime() + 16 * 60_000);
    expect((await routes.privateFile(token)).status).toBe(404);
  });

  it("knows the content types it serves, and reports disk errors other than a missing file", async () => {
    expect(fileContentType("members/signatures/a.enc")).toBe("application/octet-stream");
    expect(fileContentType("a.webp")).toBe("image/webp");
    await storage.save("folder/a.pdf", new Uint8Array([1]), { visibility: "private" });
    // "folder" is a directory, not a file.
    await expect(storage.read("folder")).rejects.toMatchObject({ code: "EISDIR" });
    // Without a clock the links expire 15 minutes from the real time.
    const real = createDiskFileStorage({ root, baseUrl: "", secret });
    expect(await real.signedReadUrl("folder/a.pdf")).toMatch(/^\/private-files\?t=/);
  });

  it("needs the link secret for signed links", async () => {
    const unsigned = createDiskFileStorage({
      root,
      baseUrl: "https://web.example",
      secret: undefined,
    });
    await expect(unsigned.signedReadUrl("x.pdf")).rejects.toThrow("LINK_SIGNING_SECRET");
  });
});
