import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, type PDFPageDrawImageOptions } from "pdf-lib";
import { htmlToBlocks, qrPng, renderLetterPdf, type LetterPdfInput } from "@website/pdf";
import { embedTimes, plain, printable, wrapRuns } from "../../packages/pdf/src/flow";
import { decodeEntities } from "../../packages/pdf/src/html";
import { drawTurned } from "../../packages/pdf/src/letter";

const JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAAnHX/2Q==",
  "base64",
);

describe("letter body HTML → printable blocks", () => {
  it("keeps paragraphs, styles, alignment and line breaks; collapses white space", () => {
    const blocks = htmlToBlocks(
      '<p>  Dengan   <strong>hormat</strong>,<br>baris <em>dua</em> <u>garis</u> </p><p style="text-align: center">Tengah</p><div></div><p> </p>text after',
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        align: "justify",
        quote: false,
        runs: [
          { text: "Dengan ", bold: false, italic: false, underline: false },
          { text: "hormat", bold: true, italic: false, underline: false },
          { text: ",", bold: false, italic: false, underline: false },
          { text: "\n", bold: false, italic: false, underline: false },
          { text: "baris ", bold: false, italic: false, underline: false },
          { text: "dua", bold: false, italic: true, underline: false },
          { text: " ", bold: false, italic: false, underline: false },
          { text: "garis", bold: false, italic: false, underline: true },
        ],
      },
      {
        kind: "paragraph",
        align: "center",
        quote: false,
        runs: [{ text: "Tengah", bold: false, italic: false, underline: false }],
      },
      {
        kind: "paragraph",
        align: "justify",
        quote: false,
        runs: [{ text: "text after", bold: false, italic: false, underline: false }],
      },
    ]);
  });

  it("numbers ordered lists, bullets unordered ones, nests, and continues an item without a marker", () => {
    const blocks = htmlToBlocks(
      '<ol><li><p>Satu</p><p>lanjutan</p></li><li>Dua<ul><li>a</li></ul></li></ol><blockquote><p>Kutipan</p></blockquote><h2>Judul</h2><hr><p>Akhir<img src="https://x.test/a.png" alt="x"></p>',
    );
    expect(
      blocks.map((b) =>
        b.kind === "rule"
          ? "rule"
          : `${b.kind}:${"marker" in b ? b.marker : ""}:${"depth" in b ? b.depth : ""}:${b.runs.map((r) => r.text).join("")}`,
      ),
    ).toEqual([
      "item:1.:0:Satu",
      "item::0:lanjutan",
      "item:2.:0:Dua",
      "item:•:1:a",
      "paragraph:::Kutipan",
      "heading:::Judul",
      "rule",
      "paragraph:::Akhir",
    ]);
    expect(blocks[4]).toMatchObject({ quote: true, align: "justify" });
    expect(blocks[5]).toMatchObject({ level: 2, align: "left" });
    expect(htmlToBlocks("</b></i></u></blockquote>x")).toMatchObject([
      { runs: [{ text: "x", bold: false }] },
    ]);
    expect(htmlToBlocks('<h3 style="text-align:right">R</h3>')).toMatchObject([
      { kind: "heading", level: 3, align: "right" },
    ]);
    expect(htmlToBlocks("<ul><li>orphan</li></ul><li>no list</li>")).toMatchObject([
      { kind: "item", marker: "•" },
      { kind: "item", marker: "•", depth: 0 },
    ]);
  });

  it("decodes entities (named, decimal, hex) and drops invalid ones", () => {
    expect(
      decodeEntities(
        "A &amp; B &lt;&gt; &quot;&apos; &nbsp;&ndash;&mdash;&hellip;&lsquo;&rsquo;&ldquo;&rdquo;",
      ),
    ).toBe("A & B <> \"'  –—…‘’“”");
    expect(decodeEntities("&#65;&#x42;&#X43;&#0;&#x110000;&unknown;")).toBe("ABC&unknown;");
  });
});

describe("text layout", () => {
  it("prints only what the standard fonts can draw", () => {
    expect(printable("Tab\there ok — “quote” é ✓ 漢")).toBe("Tab here ok — “quote” é ? ?");
  });

  it("wraps on spaces, cuts over-long words, honours <br> and trims line ends", async () => {
    const fonts = await embedTimes(await PDFDocument.create());
    const words = wrapRuns(plain("satu dua tiga empat lima"), fonts, 12, 60);
    expect(words.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual([
      "satu dua",
      "tiga empat",
      "lima",
    ]);
    expect(words.map((l) => l.last)).toEqual([false, false, true]);
    expect(wrapRuns(plain(" lead"), fonts, 12, 200)[0]?.pieces.map((p) => p.text)).toEqual([
      "lead",
    ]);
    const long = wrapRuns(plain("x".repeat(60)), fonts, 12, 100, 30);
    expect(long.length).toBeGreaterThan(2);
    expect(long.every((l) => l.width <= 100)).toBe(true);
    const broken = wrapRuns(
      [...plain("a "), { text: "\n", bold: false, italic: false, underline: false }, ...plain("b")],
      fonts,
      12,
      200,
    );
    expect(broken.map((l) => [l.pieces.map((p) => p.text).join(""), l.last])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(wrapRuns(plain(""), fonts, 12, 200)).toEqual([{ pieces: [], width: 0, last: true }]);
    const endBreak = wrapRuns(
      [...plain("a"), { text: "\n", bold: false, italic: false, underline: false }],
      fonts,
      12,
      200,
    );
    expect(endBreak.map((l) => l.last)).toEqual([true]);
  });
});

const base: LetterPdfInput = {
  letterhead: {
    parentName: "PERHIMPUNAN PELAJAR INDONESIA DUNIA",
    mainName: "PPIDK ASIA-OSEANIA",
    address: "Tokyo",
    period: "2026/2027",
    header: null,
    footer: null,
    watermark: null,
    watermarkOpacity: 0.08,
    emblem: null,
    initialsBox: false,
  },
  place: "Tokyo",
  dateText: "2 November 2026",
  number: "001/SU/SEKJEN/PPIDK-ASIANIA/XI/2026",
  attachment: "",
  subject: "Undangan Rapat Kerja",
  typeName: "Surat Undangan",
  recipient: "Ketua PPI Jepang",
  bodyHtml:
    "<p>Dengan hormat,</p><ul><li>Hari: Sabtu</li></ul><h2>Agenda</h2><hr><blockquote><p>Kutipan</p></blockquote>",
  desks: [
    {
      label: "Sekretaris Jenderal PPIDK Asia-Oseania",
      name: "Rina",
      signedOn: "2 November 2026",
      signature: null,
    },
  ],
  verification: {
    url: "https://verif.ppiasiania.id/8F3KM-QRTVW",
    label: "verif.ppiasiania.id/8F3KM-QRTVW",
    code: "8F3KM-QRTVW",
  },
  cancelledReason: null,
};

const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe("letter PDF", () => {
  it("renders an issued letter on one A4 page with its title", async () => {
    const bytes = await renderLetterPdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("001/SU/SEKJEN/PPIDK-ASIANIA/XI/2026 — Undangan Rapat Kerja");
    expect(doc.getPage(0).getSize()).toEqual({
      width: expect.closeTo(595.28, 1) as number,
      height: expect.closeTo(841.89, 1) as number,
    });
  });

  it("drafts: no number, no QR, waiting desks; long bodies flow onto more pages", async () => {
    const draft = await renderLetterPdf({
      ...base,
      number: null,
      dateText: null,
      recipient: " ",
      typeName: "",
      verification: null,
      bodyHtml: "<p>Paragraf panjang yang diulang berkali-kali sampai halaman penuh.</p>".repeat(
        80,
      ),
      desks: [
        { label: "Koordinator PPIDK Asia-Oseania", name: null, signedOn: null, signature: null },
        {
          label: "Sekretaris Jenderal PPIDK Asia-Oseania",
          name: null,
          signedOn: null,
          signature: null,
        },
      ],
    });
    expect(await pages(draft)).toBeGreaterThan(1);
    expect((await PDFDocument.load(draft)).getTitle()).toBe("Undangan Rapat Kerja");
  });

  it("uses letterhead art on every page, signature images and the cancelled stamp", async () => {
    const png = { bytes: await qrPng("art", 120), type: "png" as const };
    const jpeg = { bytes: new Uint8Array(JPEG), type: "jpeg" as const };
    const bytes = await renderLetterPdf({
      ...base,
      letterhead: {
        ...base.letterhead,
        header: png,
        footer: jpeg,
        watermark: png,
        emblem: png,
        initialsBox: true,
        watermarkOpacity: 0.9,
      },
      bodyHtml: "<p>x</p>".repeat(60),
      desks: [
        {
          label: "Koordinator PPIDK Asia-Oseania",
          name: "Budi",
          signedOn: "2 November 2026",
          signature: { image: png, widthMm: 40, rotation: -12 },
        },
        {
          label: "Sekretaris Jenderal PPIDK Asia-Oseania",
          name: "Rina",
          signedOn: "2 November 2026",
          signature: { image: jpeg, widthMm: 35, rotation: 0 },
        },
      ],
      cancelledReason: "Tanggal salah",
    });
    expect(await pages(bytes)).toBeGreaterThan(1);
    const noReason = await renderLetterPdf({
      ...base,
      place: "",
      letterhead: { ...base.letterhead, emblem: jpeg, period: null },
      bodyHtml:
        "<p><b><i>tebal miring</i></b> <u>garis bawah panjang</u> kata-yang-sangat-panjang-sekali-tanpa-spasi-supaya-dipotong-di-tengah-baris-karena-tidak-muat</p><h3>Sub</h3><ol><li><p>a</p><p>b</p></li></ol>",
      cancelledReason: "",
    });
    expect(await pages(noReason)).toBe(1);
  });

  it("turns a signature about its centre, inside its column, and skips a broken file", async () => {
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(await qrPng("sig", 120));
    const draws: PDFPageDrawImageOptions[] = [];
    const spy: Parameters<typeof drawTurned>[0] = {
      drawImage: (_image, options) => {
        draws.push(options ?? {});
      },
    };
    expect(
      drawTurned(spy, image, { x: 10, top: 500, width: 100, max: 200, rotation: 0 }),
    ).toBeCloseTo(100);
    expect(draws[0]).toMatchObject({ x: 10, y: 400, width: 100, height: 100 });
    const turned = drawTurned(spy, image, {
      x: 0,
      top: 100,
      width: 100,
      max: 100,
      rotation: 45,
    });
    expect(turned).toBeCloseTo(100);
    expect(draws[1]?.width).toBeCloseTo(100 / Math.SQRT2);

    const images = async (bytes: Uint8Array) => {
      const loaded = await PDFDocument.load(bytes);
      return loaded.context
        .enumerateIndirectObjects()
        .filter(
          ([, object]) =>
            object instanceof PDFRawStream &&
            object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
        ).length;
    };
    const desk = (signature: NonNullable<LetterPdfInput["desks"][number]["signature"]>) =>
      renderLetterPdf({
        ...base,
        desks: [
          { label: "Sekretaris Jenderal", name: "Rina", signedOn: "2 November 2026", signature },
        ],
      });
    const good = {
      image: { bytes: await qrPng("sig", 120), type: "png" as const },
      widthMm: 40,
      rotation: 90,
    };
    const broken = {
      image: { bytes: new Uint8Array([1, 2, 3]), type: "png" as const },
      widthMm: 40,
      rotation: 0,
    };
    const withImage = await images(await desk(good));
    expect(await images(await desk(broken))).toBe(withImage - 1);
  });

  it("QR codes follow the shared rules", async () => {
    const png = await qrPng("https://verif.ppiasiania.id/8F3KM-QRTVW", 300);
    expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    await expect(qrPng("x".repeat(801), 300)).rejects.toThrow("longer than 800");
  });
});
