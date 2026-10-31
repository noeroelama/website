import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreVerificationReader } from "@website/db/firestore";
import { letterCanonical, type Letter } from "@website/domain/documents";
import { isVerificationPath, verificationRewrite } from "../../apps/web/src/lib/verification-host";
import {
  createCertificatePickup,
  createVerification,
} from "../../apps/web/src/server/verification";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreVerificationReader>[0];
const at = new Date("2026-11-02T03:00:00Z");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const pdf = new TextEncoder().encode("%PDF-1.7 archived");

const stored = {
  periodId: "p1",
  typeId: "sket",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  subject: "Keterangan aktif",
  body: '<p onclick="x()">Isi <script>alert(1)</script>surat</p>',
  recipient: "Arif Nurwahid",
  place: "Tokyo",
  attachmentNote: "",
  letterDate: "2026-11-02",
  status: "issued",
  source: "editor",
  createdBy: "a",
  reviewedBy: "s",
  reviewNote: null,
  secretary: { uid: "sekjen", at },
  coordinator: null,
  number: 1,
  numberFormatted: "001/SKet/SEKJEN/PPIDK-ASIANIA/XI/2026",
  verificationCode: "8F3KM-QRTVW",
  issuedAt: at,
  cancelledAt: null,
  cancelReason: null,
  contentDigest: null as string | null,
  signers: [
    {
      name: "Rina",
      desk: "Sekretaris Jenderal PPIDK Asia-Oseania",
      position: null,
      period: "2026/2027",
      at,
    },
  ],
  letterhead: null,
  archive: { path: "letters/p1/l1_x.pdf", sha256: sha(pdf), size: pdf.length },
  upload: null,
  placement: null,
  activityCode: null,
  sheetNumberTemplate: null,
  version: 9,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
};

let fake: ReturnType<typeof fakeFirestore>;
let files: Map<string, Uint8Array>;
const verification = () =>
  createVerification({
    reader: createFirestoreVerificationReader(fake.db as unknown as Db),
    readFile: (path) => Promise.resolve(files.get(path) ?? null),
  });
const digestOf = (letter: Record<string, unknown>) =>
  sha(letterCanonical(letter as unknown as Letter, "SKet"));

beforeEach(() => {
  fake = fakeFirestore();
  files = new Map([["letters/p1/l1_x.pdf", pdf]]);
  fake.docs.set("verificationCodes/8F3KM-QRTVW", {
    kind: "letter",
    letterId: "l1",
    periodId: "p1",
  });
  fake.docs.set("letters/l1", { ...stored, contentDigest: digestOf(stored) });
  fake.docs.set("letterTypes/sket", {
    name: "Surat Keterangan",
    code: "SKet",
    contentPublic: false,
    version: 1,
  });
  fake.docs.set("orgUnits/sekjen", { name: "Sekretariat Jenderal" });
  fake.docs.set("periods/p1", { name: "2026/2027" });
});

describe("public verification of letters (D7)", () => {
  it("shows the record without sign-in; gated content needs the exact recipient", async () => {
    const view = await verification().view(" 8f3km-qrtvw ", null);
    expect(view).toMatchObject({
      code: "8F3KM-QRTVW",
      number: "001/SKet/SEKJEN/PPIDK-ASIANIA/XI/2026",
      typeName: "Surat Keterangan",
      unitName: "Sekretariat Jenderal",
      periodName: "2026/2027",
      recipientMasked: "A*** N***",
      content: "needs_name",
      bodyHtml: null,
    });
    expect(JSON.stringify(view)).not.toContain("l1");
    const opened = await verification().view("8F3KM-QRTVW", "arif nurwahid");
    expect(opened).toMatchObject({
      content: "shown",
      bodyHtml: "<p>Isi surat</p>",
      canDownload: true,
    });
    expect(await verification().view("8F3KM-QRTVW", "x".repeat(500))).toMatchObject({
      wrongName: true,
    });
  });

  it("refuses unknown, malformed and draft codes alike", async () => {
    expect(await verification().view("ZZZZZ-ZZZZZ", null)).toBeNull();
    expect(await verification().view("layanan", null)).toBeNull();
    fake.docs.set("verificationCodes/AAAAA-AAAAA", { kind: "certificate", letterId: "l1" });
    expect(await verification().view("AAAAA-AAAAA", null)).toBeNull();
    fake.docs.set("verificationCodes/CCCCC-CCCCC", { kind: "minutes", letterId: "l1" });
    expect(await verification().view("CCCCC-CCCCC", null)).toBeNull();
    fake.docs.set("verificationCodes/BBBBB-BBBBB", { kind: "letter", letterId: "gone" });
    expect(await verification().view("BBBBB-BBBBB", null)).toBeNull();
    fake.docs.set("letters/l1", { ...stored, status: "approved" });
    expect(await verification().view("8F3KM-QRTVW", null)).toBeNull();
  });

  it("changed stored text is shown to nobody; imported letters without digest still show", async () => {
    fake.docs.set("letters/l1", {
      ...stored,
      contentDigest: digestOf(stored),
      body: "<p>forged</p>",
    });
    expect(await verification().view("8F3KM-QRTVW", "Arif Nurwahid")).toMatchObject({
      content: "changed",
      bodyHtml: null,
    });
    fake.docs.set("letters/l1", { ...stored, contentDigest: null });
    fake.docs.set("letterTypes/sket", {
      name: "Surat Keterangan",
      code: "SKet",
      contentPublic: true,
      version: 1,
    });
    fake.docs.delete("orgUnits/sekjen");
    fake.docs.delete("periods/p1");
    expect(await verification().view("8F3KM-QRTVW", null)).toMatchObject({
      content: "shown",
      unitName: "PPIDK Asia-Oseania",
      periodName: null,
    });
  });

  it("downloads the archive under the same rule; never a changed or cancelled one", async () => {
    expect((await verification().download("8F3KM-QRTVW", null)).status).toBe(404);
    const ok = await verification().download("8F3KM-QRTVW", "Arif Nurwahid");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toBe(
      'attachment; filename="001-SKet-SEKJEN-PPIDK-ASIANIA-XI-2026.pdf"',
    );
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(pdf);
    files.set("letters/p1/l1_x.pdf", new TextEncoder().encode("%PDF-swapped"));
    const damaged = await verification().download("8F3KM-QRTVW", "Arif Nurwahid");
    expect(damaged.status).toBe(303);
    expect(damaged.headers.get("location")).toBe("/verify/8F3KM-QRTVW?archive=damaged");
    files.clear();
    expect((await verification().download("8F3KM-QRTVW", "Arif Nurwahid")).status).toBe(303);
    const cancelled = { ...stored, status: "cancelled", cancelledAt: at, cancelReason: "x" };
    fake.docs.set("letters/l1", { ...cancelled, contentDigest: digestOf(cancelled) });
    expect((await verification().download("8F3KM-QRTVW", "Arif Nurwahid")).status).toBe(404);
  });
});

describe("verification host (printed short addresses)", () => {
  const host = "verif.ppiasiania.id";
  it("maps /<CODE> and /<CODE>/pdf to the /verify pages; other paths to the search page", () => {
    expect(verificationRewrite(host, "/8f3km-qrtvw", host)).toBe("/verify/8F3KM-QRTVW");
    expect(verificationRewrite("VERIF.ppiasiania.id", "/8F3KM-QRTVW/pdf", host)).toBe(
      "/verify/8F3KM-QRTVW/pdf",
    );
    expect(verificationRewrite(host, "/", host)).toBe("/verify");
    expect(verificationRewrite(host, "/layanan", host)).toBe("/verify");
    expect(verificationRewrite(host, "/verify/8F3KM-QRTVW", host)).toBeNull();
    expect(verificationRewrite("ppiasiania.id", "/8F3KM-QRTVW", host)).toBeNull();
    expect(verificationRewrite(null, "/8F3KM-QRTVW", host)).toBeNull();
    expect(verificationRewrite(host, "/8F3KM-QRTVW", null)).toBeNull();
  });

  it("verification paths get the tighter rate limit", () => {
    expect(isVerificationPath("/verify")).toBe(true);
    expect(isVerificationPath("/verify/8F3KM-QRTVW/pdf")).toBe(true);
    expect(isVerificationPath("/verifyx")).toBe(false);
    expect(isVerificationPath("/certificates")).toBe(true);
  });
});

describe("public verification of certificate sheets (D5)", () => {
  beforeEach(() => {
    fake.docs.set("letters/l1", {
      ...stored,
      source: "certificate",
      subject: "LKMM 2026",
      sheetNumberTemplate: "007.{sheet:3}/SERT/LKMM/SEKJEN/XI/2026",
    });
    fake.docs.set("certificates/l1_0037", {
      batchId: "l1",
      periodId: "p1",
      seq: 37,
      name: "Arif Nurwahid, S.Kom.",
      note: "Narasumber",
      verificationCode: "DDDDD-DDDDD",
      createdAt: at,
    });
    fake.docs.set("verificationCodes/DDDDD-DDDDD", {
      kind: "certificate",
      letterId: "l1",
      certificateId: "l1_0037",
      periodId: "p1",
    });
  });

  it("shows the holder, the sheet number and the signers; never a file here", async () => {
    const view = await verification().view("ddddd-ddddd", null);
    expect(view).toEqual({
      kind: "certificate",
      code: "DDDDD-DDDDD",
      cancelled: false,
      number: "007.037/SERT/LKMM/SEKJEN/XI/2026",
      holderName: "Arif Nurwahid, S.Kom.",
      note: "Narasumber",
      activity: "LKMM 2026",
      letterDate: stored.letterDate,
      unitName: "Sekretariat Jenderal",
      periodName: "2026/2027",
      signers: expect.any(Array) as unknown[],
      cancelledAt: null,
      cancelReason: null,
    });
    expect(JSON.stringify(view)).not.toContain("l1");
    expect((await verification().download("DDDDD-DDDDD", null)).status).toBe(404);
  });

  it("a cancelled batch cancels every sheet; drafts and removed sheets are not found", async () => {
    fake.docs.set("letters/l1", {
      ...fake.docs.get("letters/l1"),
      status: "cancelled",
      cancelledAt: at,
      cancelReason: "Wrong activity",
    });
    expect(await verification().view("DDDDD-DDDDD", null)).toMatchObject({
      cancelled: true,
      cancelReason: "Wrong activity",
    });
    fake.docs.set("letters/l1", { ...fake.docs.get("letters/l1"), sheetNumberTemplate: null });
    expect(await verification().view("DDDDD-DDDDD", null)).toMatchObject({ number: "" });
    fake.docs.delete("certificates/l1_0037");
    expect(await verification().view("DDDDD-DDDDD", null)).toBeNull();
    fake.docs.set("verificationCodes/EEEEE-EEEEE", {
      kind: "certificate",
      letterId: "l1",
      certificateId: 5,
    });
    expect(await verification().view("EEEEE-EEEEE", null)).toBeNull();
  });
});

describe("certificate pickup (D5-P)", () => {
  const sheet = (batchId: string, seq: number, emailHash: string | null) => {
    const code = `${batchId.toUpperCase()}AAA-AAAA${seq}`;
    fake.docs.set(`certificates/${batchId}_000${seq}`, {
      batchId,
      periodId: "p1",
      seq,
      name: "Arif Nurwahid",
      note: null,
      verificationCode: code,
      emailHash,
      createdAt: at,
    });
  };
  const batch = (id: string, fields: Record<string, unknown> = {}) =>
    fake.docs.set(`letters/${id}`, {
      ...stored,
      source: "certificate",
      subject: `Activity ${id}`,
      sheetNumberTemplate: "007.{sheet:3}/SERT/LKMM/SEKJEN/XI/2026",
      ...fields,
    });
  const captchas: string[] = [];
  const pickup = () =>
    createCertificatePickup({
      reader: createFirestoreVerificationReader(fake.db as unknown as Db),
      captcha: (token) => {
        captchas.push(token);
        return Promise.resolve(token === "ok");
      },
      hashEmail: (email) => `h:${email}`,
      link: (code) => `https://admin.example.org/certificates/pickup?code=${code}`,
    });

  beforeEach(() => {
    batch("b1");
    batch("b2", { status: "cancelled", cancelledAt: at });
    batch("b3", { status: "review", numberFormatted: null, sheetNumberTemplate: null });
    sheet("b1", 1, "h:arif@example.org");
    sheet("b1", 2, "h:other@example.org");
    sheet("b1", 3, null);
    sheet("b2", 1, "h:arif@example.org");
    sheet("b3", 1, "h:arif@example.org");
  });

  it("an exact e-mail gives only that person's sheets of issued batches, as download links", async () => {
    const result = await pickup().lookup({ email: "  Arif@Example.org ", captcha: "ok" });
    expect(result).toEqual({
      ok: true,
      sheets: [
        {
          number: "007.001/SERT/LKMM/SEKJEN/XI/2026",
          holderName: "Arif Nurwahid",
          note: null,
          activity: "Activity b1",
          letterDate: "2026-11-02",
          href: "https://admin.example.org/certificates/pickup?code=B1AAA-AAAA1",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/"b1|h:/u);
  });

  it("skips sheets whose batch is gone or deleted; an unnumbered batch prints no number", async () => {
    sheet("b9", 1, "h:rina@example.org");
    batch("b4", { deletedAt: at });
    sheet("b4", 1, "h:rina@example.org");
    batch("b5", { sheetNumberTemplate: null });
    sheet("b5", 1, "h:rina@example.org");
    const result = await pickup().lookup({ email: "rina@example.org", captcha: "ok" });
    expect(result).toMatchObject({ ok: true, sheets: [{ activity: "Activity b5", number: "" }] });
  });

  it("no partial matches, no lists: a near address finds nothing", async () => {
    expect(await pickup().lookup({ email: "arif@example.or", captcha: "ok" })).toEqual({
      ok: true,
      sheets: [],
    });
  });

  it("refuses a failed captcha before reading anything, and a malformed e-mail", async () => {
    expect(await pickup().lookup({ email: "arif@example.org", captcha: "bot" })).toEqual({
      ok: false,
      error: "captcha",
    });
    expect(await pickup().lookup({ email: "not-an-email", captcha: "ok" })).toEqual({
      ok: false,
      error: "email",
    });
    expect(await pickup().lookup({ email: 5, captcha: "ok" })).toEqual({
      ok: false,
      error: "email",
    });
  });
});
