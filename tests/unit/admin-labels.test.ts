import { describe, expect, it } from "vitest";
import { label, LABEL_MAPS, USER_STATUS_LABELS } from "../../apps/admin/src/labels";

describe("admin label maps", () => {
  it.each(LABEL_MAPS)(
    "$name: every key has an Indonesian and an English label",
    ({ keys, labels }) => {
      for (const key of keys) {
        expect(labels[key]?.id, `${key} (id)`).toMatch(/\S/);
        expect(labels[key]?.en, `${key} (en)`).toMatch(/\S/);
      }
      // No stale labels for keys that no longer exist.
      expect(Object.keys(labels).sort()).toEqual([...keys].sort());
    },
  );

  it("shows English by default and Indonesian on request", () => {
    expect(label(USER_STATUS_LABELS, "inactive")).toBe("Inactive");
    expect(label(USER_STATUS_LABELS, "inactive", "id")).toBe("Nonaktif");
  });
});
