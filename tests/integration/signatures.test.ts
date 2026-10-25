import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreSignatureStore } from "@website/db/firestore";
import { signaturePath, SignatureSettingsSchema } from "@website/domain/documents";
import { qrPng } from "@website/pdf";
import { decryptField } from "@website/security";
import { createOwnSignature } from "../../apps/web/src/server/signature";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreSignatureStore>[0];
const KEY = randomBytes(32).toString("base64");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const ari = { uid: "ari" };

let fake: ReturnType<typeof fakeFirestore>;
let files: Map<string, Uint8Array>;
let key: string | null;
let uuid = 0;
const store = () => createFirestoreSignatureStore(fake.db as unknown as Db);
const own = () =>
  createOwnSignature({
    store: store(),
    storage: {
      save: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
      read: (path) => Promise.resolve(files.get(path) ?? null),
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
    },
    key: () => key,
    now: () => new Date("2026-11-04T01:00:00Z"),
    uuid: () => `${String((uuid += 1)).padStart(8, "0")}-0000-4000-8000-000000000000`,
  });
const upload = (owner: { uid: string } | null, bytes: Uint8Array, query = "") =>
  own().upload(
    owner,
    new Request(`https://web.test/api/account/signature${query}`, { method: "POST", body: bytes }),
  );

beforeEach(() => {
  fake = fakeFirestore();
  files = new Map();
  key = KEY;
  uuid = 0;
});

describe("personal signatures (D4)", () => {
  it("settings are bounded; file names are fresh per upload", () => {
    expect(SignatureSettingsSchema.parse({})).toEqual({ widthMm: 40, rotation: 0 });
    expect(SignatureSettingsSchema.safeParse({ widthMm: 9 }).success).toBe(false);
    expect(SignatureSettingsSchema.safeParse({ rotation: 181 }).success).toBe(false);
    expect(signaturePath("ari", "abcd-ef01-2345")).toBe("members/signatures/ari_abcdef01.enc");
  });

  it("stores the owner's image encrypted, shows it only to them, replaces and removes it", async () => {
    const png = await qrPng("ari", 120);
    const response = await upload(ari, png, "?widthMm=35&rotation=-8");
    expect(response.status).toBe(201);
    const path = "members/signatures/ari_00000001.enc";
    const stored = files.get(path) as Uint8Array;
    // Never the image itself in Storage.
    expect(Buffer.from(stored).includes(Buffer.from(png.slice(1, 4)))).toBe(false);
    expect(decryptField(new TextDecoder().decode(stored), KEY)).toEqual(png);
    expect(await own().settings(ari)).toEqual({
      widthMm: 35,
      rotation: -8,
      version: 1793754000000,
    });

    const view = await own().view(ari);
    expect(view.headers.get("content-type")).toBe("image/png");
    expect(view.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await view.arrayBuffer())).toEqual(png);
    // Keyed by the session's uid only: nobody else has one.
    expect((await own().view({ uid: "rina" })).status).toBe(404);
    expect(await own().settings({ uid: "rina" })).toBeNull();

    // Replacing stores the new file first, then removes the old one.
    expect((await upload(ari, JPEG)).status).toBe(201);
    expect([...files.keys()]).toEqual(["members/signatures/ari_00000002.enc"]);
    expect((await own().view(ari)).headers.get("content-type")).toBe("image/jpeg");
    expect(await store().get("ari")).toMatchObject({ type: "jpeg", widthMm: 40, rotation: 0 });

    expect(await own().configure(ari, { widthMm: 50, rotation: 3 })).toEqual({ ok: true });
    expect(await store().get("ari")).toMatchObject({ widthMm: 50, rotation: 3 });
    expect(await own().configure(ari, { widthMm: 50, rotation: 3, uid: "x" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await own().configure({ uid: "rina" }, { widthMm: 50 })).toEqual({
      ok: false,
      error: "none",
    });

    expect(await own().remove(ari)).toEqual({ ok: true });
    expect(files.size).toBe(0);
    expect(await store().get("ari")).toBeNull();
    expect(await own().remove(ari)).toEqual({ ok: true });
    expect((await own().view(ari)).status).toBe(404);
  });

  it("refuses signed-out people, bad files, bad settings and a missing key", async () => {
    const png = await qrPng("x", 60);
    expect((await upload(null, png)).status).toBe(401);
    expect((await own().view(null)).status).toBe(401);
    expect(await own().settings(null)).toBeNull();
    expect(await own().configure(null, {})).toEqual({ ok: false, error: "signin" });
    expect(await own().remove(null)).toEqual({ ok: false, error: "signin" });
    expect(await (await upload(ari, new TextEncoder().encode("%PDF-1.7"))).json()).toEqual({
      ok: false,
      error: "not_image",
    });
    expect(await (await upload(ari, png, "?widthMm=200")).json()).toEqual({
      ok: false,
      error: "settings",
    });
    expect(await (await upload(ari, png, "?rotation=abc")).json()).toEqual({
      ok: false,
      error: "settings",
    });
    const large = await upload(ari, new Uint8Array(2 * 1024 * 1024 + 1));
    expect([large.status, await large.json()]).toEqual([413, { ok: false, error: "too_large" }]);
    expect(files.size).toBe(0);
    expect(await store().get("bad/id")).toBeNull();

    await upload(ari, png);
    key = null;
    expect(await (await upload(ari, png)).json()).toEqual({ ok: false, error: "off" });
    expect((await own().view(ari)).status).toBe(404);
  });
});
