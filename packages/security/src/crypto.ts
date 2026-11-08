import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const VERSION = "v1";

function keyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes (base64).");
  return key;
}

export function encryptField(bytes: Uint8Array, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyBase64), iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

export function decryptField(text: string, keyBase64: string): Uint8Array {
  const [version, iv, tag, data, extra] = text.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined || extra !== undefined) {
    throw new Error("Unknown encrypted value.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFrom(keyBase64),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return new Uint8Array(
    Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]),
  );
}
