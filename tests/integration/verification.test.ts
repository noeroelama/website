import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreVerificationReader } from "@website/db/firestore";
import { letterCanonical, type Letter } from "@website/domain/documents";
import { isVerificationPath, verificationRewrite } from "../../apps/web/src/lib/verification-host";
import { createVerification } from "../../apps/web/src/server/verification";
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
    expect((await verification().view("8F3KM-QRTVW", "x".repeat(500)))?.wrongName).toBe(true);
  });

  it("refuses unknown, malformed and draft codes alike", async () => {
    expect(await verification().view("ZZZZZ-ZZZZZ", null)).toBeNull();
    expect(await verification().view("layanan", null)).toBeNull();
    fake.docs.set("verificationCodes/AAAAA-AAAAA", { kind: "certificate", sheetId: "x" });
    expect(await verification().view("AAAAA-AAAAA", null)).toBeNull();
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
  });
});
