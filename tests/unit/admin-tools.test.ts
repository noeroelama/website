import { describe, expect, it } from "vitest";
import {
  QR_DOWNLOAD_PX,
  QR_MAX_LENGTH,
  qrLogoPlate,
  qrTextProblem,
} from "@website/domain/documents";
import { withoutScheme } from "../../apps/admin/src/components/format";

describe("Tools page short-link display", () => {
  it("shows links without the scheme, like the design (goppi.id/…, Redirects to ppiasiania.id/…)", () => {
    expect(withoutScheme("https://ppiasiania.id/simposium/daftar")).toBe(
      "ppiasiania.id/simposium/daftar",
    );
    expect(withoutScheme("http://forms.gle/6xQm2VvH1")).toBe("forms.gle/6xQm2VvH1");
    expect(withoutScheme("HTTPS://goppi.id/")).toBe("goppi.id");
  });

  it("leaves text without a scheme unchanged", () => {
    expect(withoutScheme("goppi.id/beasiswa-lpdp")).toBe("goppi.id/beasiswa-lpdp");
    expect(withoutScheme("")).toBe("");
  });
});

describe("QR rules (D8)", () => {
  it("refuses empty and over-long content", () => {
    expect(qrTextProblem("  ")).toBe("Enter some content first.");
    expect(qrTextProblem("x".repeat(QR_MAX_LENGTH))).toBeNull();
    expect(qrTextProblem("x".repeat(QR_MAX_LENGTH + 1))).toBe("Use at most 800 characters.");
  });

  it("puts the logo on a centred plate small enough for high error correction", () => {
    for (const size of Object.values(QR_DOWNLOAD_PX)) {
      const plate = qrLogoPlate(size);
      expect(plate.x).toBe(plate.y);
      expect(Math.abs(plate.x * 2 + plate.size - size)).toBeLessThanOrEqual(1);
      expect((plate.size * plate.size) / (size * size)).toBeLessThan(0.05);
      expect(plate.logo.x).toBeGreaterThan(plate.x);
      expect(plate.logo.x + plate.logo.size).toBeLessThan(plate.x + plate.size);
    }
  });
});
