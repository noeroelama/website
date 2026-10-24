import { describe, expect, it } from "vitest";
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
