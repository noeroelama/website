import { describe, expect, it } from "vitest";
import { DICTIONARIES, languageFrom, LANGUAGES } from "../../apps/web/src/i18n/dictionaries";

/** Every leaf path of a nested dictionary, e.g. "nav.home". */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${prefix}[${i}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
    leaves(inner, prefix ? `${prefix}.${key}` : key),
  );
}
const at = (value: unknown, path: string): unknown =>
  path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);

describe("public site language (ID / EN)", () => {
  it("Indonesian is the default; only a valid cookie value switches to English", () => {
    expect(LANGUAGES).toEqual(["id", "en"]);
    expect(languageFrom(undefined)).toBe("id");
    expect(languageFrom("en")).toBe("en");
    expect(languageFrom("id")).toBe("id");
    expect(languageFrom("fr")).toBe("id");
    expect(languageFrom("EN")).toBe("id");
  });

  it("both dictionaries have exactly the same keys, and no text is empty", () => {
    const id = leaves(DICTIONARIES.id).sort();
    const en = leaves(DICTIONARIES.en).sort();
    expect(en).toEqual(id);
    for (const path of id) {
      expect(at(DICTIONARIES.id, path), `id ${path}`).toMatch(/\S/);
      expect(at(DICTIONARIES.en, path), `en ${path}`).toMatch(/\S/);
    }
  });
});
