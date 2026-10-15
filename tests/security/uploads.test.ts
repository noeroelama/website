import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@website/audit";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createImageUploads } from "../../apps/admin/src/server/images";

const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "staff-1",
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

let saved: Map<string, { bytes: Uint8Array; visibility: string }>;
let audit: AuditEvent[];
const uploads = () =>
  createImageUploads({
    storage: {
      save(path, bytes, { visibility }) {
        saved.set(path, { bytes, visibility });
        return Promise.resolve({
          url: visibility === "public" ? `https://cdn.example/${path}` : null,
        });
      },
    },
    appendAudit: (event) => {
      audit.push(event);
      return Promise.resolve();
    },
    now: () => new Date("2026-10-16T00:00:00Z"),
    uuid: () => "abcdef0123456789",
  });
const post = (body: Uint8Array | string, headers: Record<string, string> = {}) =>
  new Request("https://admin.example/api/uploads/banner", { method: "POST", body, headers });
const asEditor = (preset: string, request: Request, principal = staff(["events.edit"])) =>
  uploads()(preset, request, () => Promise.resolve(principal), context);

beforeEach(() => {
  saved = new Map();
  audit = [];
});

describe("image upload route (POST /api/uploads/<preset>)", () => {
  it("re-encodes to WebP inside 2400 px, strips metadata, adds a 480 px thumbnail and audits it", async () => {
    const photo = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps-owner" } } })
      .toBuffer();
    const response = await asEditor("banner", post(photo, { "content-type": "image/jpeg" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      path: "events/banners/banner_1792108800000_abcdef01.webp",
      thumbPath: "events/banners/banner_1792108800000_abcdef01_thumb.webp",
      url: "https://cdn.example/events/banners/banner_1792108800000_abcdef01.webp",
      thumbUrl: "https://cdn.example/events/banners/banner_1792108800000_abcdef01_thumb.webp",
      width: 2400,
      height: 1200,
    });
    const main = await sharp(saved.get(body["path"] as string)?.bytes).metadata();
    expect(main).toMatchObject({ format: "webp", width: 2400, height: 1200 });
    expect(main.exif).toBeUndefined();
    const thumb = await sharp(saved.get(body["thumbPath"] as string)?.bytes).metadata();
    expect(thumb).toMatchObject({ format: "webp", width: 480 });
    expect(audit).toEqual([
      expect.objectContaining({
        action: "UPLOAD",
        module: "events",
        actor: { type: "staff", id: "staff-1", email: "staff@example.org" },
        revertible: false,
      }),
    ]);
  });

  it("private presets (KTM) return the storage path only, never a URL", async () => {
    const png = await sharp({
      create: { width: 600, height: 400, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const response = await asEditor("ktm", post(png), staff(["members.edit"]));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ url: null, thumbUrl: null });
    expect([...saved.values()].every((file) => file.visibility === "private")).toBe(true);
  });

  it("refuses SVG and files whose bytes are not an image, whatever the header says", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    for (const body of [svg, new TextEncoder().encode("GIF89a........")]) {
      const response = await asEditor("banner", post(body, { "content-type": "image/png" }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: "File type not supported" });
    }
    // No body at all.
    const empty = new Request("https://admin.example/api/uploads/banner", { method: "POST" });
    expect((await asEditor("banner", empty)).status).toBe(400);
    // Right magic bytes, broken image.
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect((await asEditor("banner", post(broken))).status).toBe(400);
    expect(saved.size).toBe(0);
    expect(audit).toHaveLength(0);
  });

  it("refuses bodies over 5 MB before processing them (header or actual size)", async () => {
    const declared = await asEditor(
      "banner",
      post("x", { "content-length": String(6 * 1024 * 1024) }),
    );
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ message: "Maximum file size is 5 MB" });
    const actual = await asEditor("banner", post(new Uint8Array(5 * 1024 * 1024 + 1)));
    expect(actual.status).toBe(413);
    expect(saved.size).toBe(0);
  });

  it("checks the page permission before reading the file, and refuses unknown presets", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    expect((await asEditor("banner", post(png), staff(["articles.edit"]))).status).toBe(403);
    expect(
      (await uploads()("banner", post(png), () => Promise.resolve(null), context)).status,
    ).toBe(401);
    expect((await asEditor("../../etc", post(png))).status).toBe(404);
    expect(saved.size).toBe(0);
  });
});
