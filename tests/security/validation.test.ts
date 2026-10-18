import { describe, expect, it } from "vitest";
import { z } from "zod";
import { safeId, safeText, sanitizeText } from "@website/security/validation";

describe("input sanitization", () => {
  it("normalizes Unicode, strips control and bidi-override characters, collapses whitespace", () => {
    expect(sanitizeText("  Café\u0000  ‮evil‬ \n next ")).toBe("Café evil next");
    expect(sanitizeText("line1\r\nline2", { multiline: true })).toBe("line1\r\nline2");
    expect(sanitizeText("a​b")).toBe("ab");
  });

  it("safeText rejects HTML, empty and over-long values", () => {
    const name = safeText(10);
    expect(name.parse("  Siti  ")).toBe("Siti");
    expect(name.safeParse("<script>").success).toBe(false);
    expect(name.safeParse("a > b").success).toBe(false);
    expect(name.safeParse(" \u0000 ").success).toBe(false);
    expect(name.safeParse("x".repeat(11)).success).toBe(false);
    expect(name.safeParse(42).success).toBe(false);
  });

  it("safeText allows an empty value only for optional fields (still no HTML)", () => {
    const optional = safeText(10, { allowEmpty: true });
    expect(optional.parse("   ")).toBe("");
    expect(optional.safeParse("<b>").success).toBe(false);
    expect(safeText(10).safeParse("").success).toBe(false);
  });

  it("safeText keeps line breaks only when multiline", () => {
    expect(safeText(50, { multiline: true }).parse("a\nb")).toBe("a\nb");
    expect(safeText(50).parse("a\nb")).toBe("a b");
  });

  it("safeId blocks Firestore path and reserved-id injection", () => {
    expect(safeId.parse("event_2026-01")).toBe("event_2026-01");
    for (const bad of [
      "../users",
      "a/b",
      "__proto__",
      "__name__",
      "",
      "x".repeat(129),
      "a b",
      "a.b",
    ]) {
      expect(safeId.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("strict schemas reject prototype-pollution keys", () => {
    const schema = z.object({ name: safeText(20) }).strict();
    expect(schema.safeParse(JSON.parse('{"name":"a","__proto__":{"admin":true}}')).success).toBe(
      false,
    );
    expect(schema.safeParse(JSON.parse('{"name":"a","constructor":{}}')).success).toBe(false);
  });
});
