import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, sha256Hex } from "@website/security";

const key = randomBytes(32).toString("base64");
const bytes = new TextEncoder().encode("signature image bytes");

describe("field encryption (AES-256-GCM, FIELD_ENCRYPTION_KEY)", () => {
  it("round-trips bytes with a fresh IV every time", () => {
    const first = encryptField(bytes, key);
    const second = encryptField(bytes, key);
    expect(first).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(first).not.toBe(second);
    expect(decryptField(first, key)).toEqual(bytes);
  });

  it("refuses a changed text, another key, an unknown version and bad keys", () => {
    const text = encryptField(bytes, key);
    const [v, iv, tag, data] = text.split(":") as [string, string, string, string];
    const flipped = Buffer.from(data, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptField(`${v}:${iv}:${tag}:${flipped.toString("base64url")}`, key)).toThrow();
    expect(() => decryptField(text, randomBytes(32).toString("base64"))).toThrow();
    expect(() => decryptField(`v2:${iv}:${tag}:${data}`, key)).toThrow("Unknown encrypted value");
    expect(() => decryptField("v1:abc", key)).toThrow("Unknown encrypted value");
    expect(() => encryptField(bytes, randomBytes(16).toString("base64"))).toThrow(
      "FIELD_ENCRYPTION_KEY",
    );
    expect(() => encryptField(bytes, "")).toThrow("FIELD_ENCRYPTION_KEY");
  });

  it("sha256Hex is the hex SHA-256 of the bytes (archive checks)", () => {
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
