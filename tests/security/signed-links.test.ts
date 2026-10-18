import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyedHash, signLink, verifyLink } from "@website/security";

const secret = "link-signing-secret-for-tests-0123456789";
const now = new Date("2026-10-18T00:00:00Z");

describe("signed links (unsubscribe today; later letters and certificates)", () => {
  it("round-trips the data and refuses any change to it or to the signature", () => {
    const token = signLink({ a: "unsubscribe", s: "abc" }, secret);
    expect(verifyLink(token, secret, now)).toEqual({ a: "unsubscribe", s: "abc" });
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ a: "unsubscribe", s: "xyz" })).toString(
      "base64url",
    );
    expect(verifyLink(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyLink(`${body}.${sig.slice(1)}`, secret, now)).toBeNull();
    expect(verifyLink(token, "another-secret-of-the-same-length-000000", now)).toBeNull();
    for (const bad of ["", "abc", "a.b.c", `${body}.`, "!!!.???"]) {
      expect(verifyLink(bad, secret, now), bad).toBeNull();
    }
  });

  it("expires when an expiry is given", () => {
    const token = signLink({ a: "x" }, secret, new Date("2026-10-19T00:00:00Z"));
    expect(verifyLink(token, secret, now)).toEqual({ a: "x" });
    expect(verifyLink(token, secret, new Date("2026-10-19T00:00:01Z"))).toBeNull();
  });

  it("refuses a signed body that is not an object of strings", () => {
    const body = Buffer.from("[1,2]").toString("base64url");
    const sig = createHmac("sha256", secret).update(`link:${body}`).digest("base64url");
    expect(verifyLink(`${body}.${sig}`, secret, now)).toBeNull();
  });

  it("keyed hash: stable per purpose and secret, never the input itself", () => {
    const a = keyedHash("email", "sari@example.org", secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedHash("email", "sari@example.org", secret)).toBe(a);
    expect(keyedHash("other", "sari@example.org", secret)).not.toBe(a);
    expect(a).not.toContain("sari");
  });
});
