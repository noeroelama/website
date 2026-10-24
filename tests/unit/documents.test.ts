import { describe, expect, it } from "vitest";
import { checkNumberPattern, formatNumber, romanMonth } from "@website/domain/documents";
import { isPdf } from "@website/domain/shared";

const base = {
  seq: 7,
  padding: 3,
  typeCode: " UND ",
  unitCode: "SEKJEN",
  activityCode: null,
  date: "2026-08-14",
};

describe("letter numbers (PPIDK patterns kept so imported types number the same way)", () => {
  it("formats every token", () => {
    expect(formatNumber("{nomor}/{jenis}/{unit}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}", base)).toBe(
      "007/UND/SEKJEN/PPIDK-ASIANIA/VIII/2026",
    );
    expect(formatNumber("{nomor}-{bulan}-{tahun_pendek}", { ...base, seq: 1234 })).toBe(
      "1234-08-26",
    );
    expect(
      formatNumber("{nomor}/{kode_kegiatan}/{unit}", {
        ...base,
        sheet: 37,
        unitCode: null,
        activityCode: " lkmm ",
      }),
    ).toBe("007.037/LKMM/PPIDK");
    expect(formatNumber("{nomor}/{kode_kegiatan}", base)).toBe("007/");
  });

  it("Roman months I-XII", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(romanMonth).join(" ")).toBe(
      "I II III IV V VI VII VIII IX X XI XII",
    );
  });

  it("refuses unknown tokens: on save (check) and when formatting", () => {
    expect(checkNumberPattern("{nomor}/{jenis}/{tahun}")).toBeNull();
    expect(checkNumberPattern("{jenis}/{tahun}")).toBe("The pattern needs {nomor}.");
    expect(checkNumberPattern("{nomor}/{year}")).toBe("Unknown placeholder {year}.");
    expect(() => formatNumber("{nomor}/{year}", base)).toThrow("Unknown placeholder {year}.");
  });
});

describe("private files", () => {
  it("isPdf checks the %PDF- magic bytes", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("%PDF"))).toBe(false);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
  });
});
