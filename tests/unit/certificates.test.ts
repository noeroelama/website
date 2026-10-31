import { describe, expect, it } from "vitest";
import {
  certificateCitation,
  certificateId,
  parseParticipants,
  sheetNumber,
  sheetNumberTemplate,
  titleCaseName,
} from "@website/domain/documents";

describe("certificate participants (D5)", () => {
  it("one per line; TAB ; | separate the note, never a comma; spaces tidied; duplicates kept", () => {
    expect(
      parseParticipants(
        "  Arif  Nurwahid, S.Kom.\tNarasumber \r\nRina;Juara 1\n\n | ignored\nBudi|Panitia|extra\nRina;Juara 1\nSiti",
      ),
    ).toEqual([
      { name: "Arif Nurwahid, S.Kom.", note: "Narasumber", email: null },
      { name: "Rina", note: "Juara 1", email: null },
      { name: "Budi", note: "Panitia|extra", email: null },
      { name: "Rina", note: "Juara 1", email: null },
      { name: "Siti", note: null, email: null },
    ]);
    expect(parseParticipants(" \n\t\n")).toEqual([]);
  });

  it("an e-mail column (any place after the name) is the pickup e-mail, never the note", () => {
    expect(
      parseParticipants(
        "Arif\tNarasumber\t Arif@Example.ORG \nRina;rina@example.org;Juara 1\nSiti|siti@example.org",
      ),
    ).toEqual([
      { name: "Arif", note: "Narasumber", email: "arif@example.org" },
      { name: "Rina", note: "Juara 1", email: "rina@example.org" },
      { name: "Siti", note: null, email: "siti@example.org" },
    ]);
  });

  it("refuses names or notes that are too long or contain HTML, naming the line", () => {
    expect(() => parseParticipants(`Ari\n${"x".repeat(161)}`)).toThrow("Line 2:");
    expect(() => parseParticipants("Ari;<b>x</b>")).toThrow("Line 1:");
    expect(() => parseParticipants("A\n".repeat(1000))).toThrow("Paste at most 1000 lines");
  });

  it("title case keeps degrees, initials and particles readable", () => {
    expect(titleCaseName("ARIF NURWAHID, S.KOM.")).toBe("Arif Nurwahid, S.KOM.");
    expect(titleCaseName("siti binti ahmad")).toBe("Siti binti Ahmad");
    expect(titleCaseName("m. rizky al-farisi")).toBe("M. Rizky Al-Farisi");
  });

  it("sheet numbers come from the batch number frozen at issue", () => {
    const template = sheetNumberTemplate(
      "{nomor}/SERT/{kode_kegiatan}/{unit}/{bulan_romawi}/{tahun}",
      {
        seq: 7,
        padding: 3,
        typeCode: "SERT",
        unitCode: "SEKJEN",
        activityCode: "lkmm",
        date: "2026-11-02",
      },
    );
    expect(template).toBe("007.{sheet:3}/SERT/LKMM/SEKJEN/XI/2026");
    expect(sheetNumber(template, 37)).toBe("007.037/SERT/LKMM/SEKJEN/XI/2026");
    expect(sheetNumber(null, 37)).toBeNull();
    expect(certificateId("b1", 37)).toBe("b1_0037");
  });

  it("the citation is the batch text, or the default with the activity", () => {
    expect(
      certificateCitation("<p>atas <b>dedikasinya</b></p><p>sebagai panitia</p>", "LKMM"),
    ).toBe("atas dedikasinya\nsebagai panitia");
    expect(
      certificateCitation("Tom &amp; Jerry&nbsp;&lt;3&gt; &quot;x&quot; &#39;y&#39;", "z"),
    ).toBe("Tom & Jerry <3> \"x\" 'y'");
    expect(certificateCitation("  ", "LKMM 2026")).toBe(
      "atas partisipasinya dalam kegiatan LKMM 2026",
    );
  });
});
