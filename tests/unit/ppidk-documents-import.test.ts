import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlVerificationReader } from "@website/db/sql";
import { parseTsv } from "../../packages/db/src/ppidk/people";
import { mapPpidkDocuments, type PpidkDocumentTables } from "../../packages/db/src/ppidk/documents";
import { createVerification } from "../../apps/web/src/server/verification";
import { fakeDb } from "../support/fake-db";

const now = new Date("2026-11-04T00:00:00Z");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
/** `mysql --batch` output of these rows: missing columns are NULL, line breaks escaped. */
const table = (rows: Array<Record<string, string>>) => {
  const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (value: string | undefined) =>
    value === undefined ? "NULL" : value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return parseTsv(
    [header.join("\t"), ...rows.map((r) => header.map((h) => cell(r[h])).join("\t"))].join("\n") +
      "\n",
  );
};

/** PPIDK `SidikSurat::kanonik` (keys in Indonesian, PPIDK user ids). */
const ppidkDigest = (l: Record<string, string>, typeCode: string) =>
  sha(
    [
      ["nomor", l["number_formatted"] ?? ""],
      ["tanggal", l["letter_date"] ?? ""],
      ["jenis", typeCode],
      ["perihal", (l["subject"] ?? "").trim()],
      ["penerima", (l["recipient"] ?? "").trim()],
      ["badan", (l["body"] ?? "").replace(/\r\n?/g, "\n").trim()],
      ["penandatangan", l["signed_by_user_id"] ?? ""],
      ["koordinator", l["coordinator_user_id"] ?? ""],
    ]
      .map(([k, v]) => `${k}=${v}`)
      .join("\x1f"),
  );

const issued = {
  period_id: "3",
  letter_type_id: "5",
  org_unit_id: "40",
  status: "issued",
  sumber: "editor",
  subject: "Undangan rapat",
  body: "<p>Isi\r\nsurat</p>",
  recipient: "Arif Nurwahid",
  place: "Tokyo",
  letter_date: "2026-08-03",
  created_by_user_id: "1",
  signed_by_user_id: "1",
  approved_at: "2026-08-03 01:00:00",
  issued_at: "2026-08-03 02:00:00",
  created_at: "2026-08-01 00:00:00",
};
const l100 = {
  ...issued,
  id: "100",
  number: "12",
  number_formatted: "012/UND/SEKJEN/PPIDK-ASIANIA/VIII/2026",
  verification_code: "8F3KM-QRTVW",
  pdf_path: "surat/3/100.pdf",
  signature_snapshot: JSON.stringify([
    {
      nama: "Ana Putri",
      meja: "Sekretariat Jenderal",
      jabatan: "Sekretaris Jenderal",
      periode: "2026/2027",
      waktu: "2026-08-03T01:00:00+00:00",
    },
  ]),
};
const l102 = {
  ...issued,
  id: "102",
  letter_type_id: "7",
  number: "2",
  number_formatted: "002/SKet/SEKJEN/2026",
  verification_code: "CHNGD-23456",
};

const tables: PpidkDocumentTables = {
  users: table([
    { id: "1", email: "ana@example.org", name: "Ana" },
    { id: "2", email: "rio@example.org", name: "Rio" },
    { id: "9", name: "Tanpa surel" },
  ]),
  org_units: table([
    { id: "40", period_id: "3", name: "Sekretariat Jenderal", code: "SEKJEN" },
    { id: "41", period_id: "3", parent_id: "40", name: "Biro Kesekretariatan", code: "BK" },
  ]),
  letter_types: table([
    {
      id: "5",
      name: "Surat Undangan",
      code: "UND",
      number_format: "{nomor}/{jenis}/{unit}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}",
      number_padding: "3",
      requires_coordinator: "0",
      requires_recipient: "1",
      content_public: "1",
      is_active: "1",
      sort: "1",
      created_at: "2026-08-01 00:00:00",
    },
    {
      id: "6",
      name: "Sertifikat",
      code: "SERT",
      description: "Sertifikat kegiatan",
      number_format: "{nomor}/{jenis}/{kode_kegiatan}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}",
      number_padding: "3",
      requires_coordinator: "1",
      requires_recipient: "0",
      content_public: "1",
      is_active: "1",
      sort: "2",
    },
    {
      id: "7",
      name: "Surat Keterangan",
      code: "SKet",
      number_format: "{nomer}/{jenis}/{unit}/{tahun}",
      number_padding: "3",
      requires_coordinator: "0",
      requires_recipient: "1",
      content_public: "0",
      is_active: "0",
      sort: "3",
    },
    { id: "8", name: "Permohonan", code: "SP m", number_format: "{nomor}/{jenis}" },
  ]),
  letter_sequences: table([
    { id: "1", period_id: "3", letter_type_id: "5", last_number: "12" },
    { id: "2", period_id: "3", letter_type_id: "6", last_number: "1" },
  ]),
  letters: table([
    { ...l100, content_digest: ppidkDigest(l100, "UND") },
    {
      ...issued,
      id: "101",
      status: "cancelled",
      number: "11",
      number_formatted: "011/UND/SEKJEN/PPIDK-ASIANIA/VIII/2026",
      verification_code: "abcde-fghjk",
      cancelled_at: "2026-08-04 00:00:00",
      cancel_reason: "Salah tanggal",
      pdf_path: "surat/3/101.pdf",
    },
    // Stored text changed after issue: PPIDK shows it to nobody, and neither does the platform.
    { ...l102, content_digest: ppidkDigest({ ...l102, body: "<p>asli</p>" }, "SKet") },
    {
      ...issued,
      id: "103",
      status: "terkoreksi",
      org_unit_id: "41",
      signed_by_user_id: "",
      approved_at: "",
      issued_at: "",
    },
    {
      ...issued,
      id: "104",
      letter_type_id: "6",
      sumber: "sertifikat",
      kode_kegiatan: "lkmm",
      subject: "LKMM 2026",
      body: "",
      recipient: "",
      letter_date: "2026-09-10",
      number: "1",
      number_formatted: "001/SERT/LKMM/PPIDK-ASIANIA/IX/2026",
      verification_code: "BATCH-22222",
      coordinator_user_id: "2",
      coordinator_approved_at: "2026-09-10 00:30:00",
    },
    {
      ...issued,
      id: "105",
      status: "menunggu_berkas",
      sumber: "unggah",
      number: "10",
      number_formatted: "010/UND/SEKJEN/PPIDK-ASIANIA/VIII/2026",
      verification_code: "WAKTS-22222",
      issued_at: "",
      pdf_path: "surat/3/105.pdf",
      berkas_sha256: "b".repeat(64),
      berkas_diunggah_pada: "2026-08-05 00:00:00",
      meta: JSON.stringify({ unggahan: { nomor_diperiksa: true } }),
      penempatan_ttd: JSON.stringify({ halaman: 2, x_mm: 120, y_mm: 240, lebar_mm: 40 }),
    },
    {
      ...issued,
      id: "106",
      sumber: "unggah",
      org_unit_id: "",
      number: "9",
      number_formatted: "009/UND/PPIDK/PPIDK-ASIANIA/VIII/2026",
      verification_code: "SWAPD-22222",
      pdf_path: "surat/3/106.pdf",
      berkas_sha256: "0".repeat(64),
    },
    { ...issued, id: "107", status: "arsip" },
  ]),
  certificates: table([
    {
      id: "900",
      letter_id: "104",
      urut: "1",
      nama: "Ana Putri",
      verification_code: "SHEET-22222",
      created_at: "2026-09-09 00:00:00",
    },
    {
      id: "901",
      letter_id: "104",
      urut: "3",
      nama: "Rio",
      keterangan: "Narasumber",
      verification_code: "SHEET-33333",
    },
    { id: "902", letter_id: "999", urut: "1", nama: "X", verification_code: "LOSTS-22222" },
    { id: "903", letter_id: "104", urut: "4", nama: "Y", verification_code: "8F3KM-QRTVW" },
    { id: "904", letter_id: "104", urut: "2", nama: "Z", verification_code: "I0I0I-I0I0I" },
  ]),
  incoming_letters: table([
    {
      id: "300",
      period_id: "3",
      agenda_number: "041/AG/VIII/2026",
      sender: "KBRI Tokyo",
      origin_number: "B-12/KBRI",
      subject: "Undangan",
      letter_date: "2026-08-01",
      received_date: "2026-08-02",
      file_path: "masuk/300.pdf",
      status: "didisposisi",
      recorded_by_user_id: "1",
      created_at: "2026-08-02 00:00:00",
    },
    {
      id: "301",
      period_id: "3",
      agenda_number: "007/AG/IX/2026",
      sender: "PPI Jepang",
      subject: "Laporan",
      received_date: "2026-09-01",
      file_path: "masuk/301.jpg",
      status: "arsip",
    },
    { id: "302", period_id: "3", agenda_number: "1", sender: "x", subject: "x", status: "?" },
  ]),
  incoming_letter_sequences: table([{ id: "1", period_id: "3", last_number: "40" }]),
  letter_dispositions: table([
    {
      id: "400",
      incoming_letter_id: "300",
      from_user_id: "1",
      to_org_unit_id: "41",
      instruction: "Tindak lanjuti",
      due_date: "2026-08-10",
      status: "diproses",
      created_at: "2026-08-02 01:00:00",
    },
    {
      id: "401",
      incoming_letter_id: "300",
      parent_id: "400",
      from_user_id: "1",
      to_user_id: "2",
      instruction: "Siapkan balasan",
      status: "selesai",
      response: "Sudah",
      completed_at: "2026-08-03 00:00:00",
    },
    {
      id: "402",
      incoming_letter_id: "999",
      from_user_id: "1",
      instruction: "x",
      status: "menunggu",
    },
  ]),
};

const files: Record<string, { size: number; sha256: string }> = {
  "surat/3/100.pdf": { size: 2048, sha256: "a".repeat(64) },
  "surat/3/105.pdf": { size: 4096, sha256: "b".repeat(64) },
  "surat/3/106.pdf": { size: 4096, sha256: "c".repeat(64) },
  "masuk/300.pdf": { size: 1024, sha256: "d".repeat(64) },
};
const plan = mapPpidkDocuments(tables, {
  uidOf: (id) => (id === "1" ? "firebase-ana" : `ppidk-${id}`),
  file: (path) => files[path] ?? null,
  now,
});
const doc = (path: string) => plan.writes.find((w) => w.path === path)?.data;
const reasons = plan.skipped.map((s) => `${s.table}/${s.id}: ${s.reason}`);

/** The plan written to a database, read through the public verification page. */
const verify = (code: string, typedName: string | null = null) => {
  const fake = fakeDb();
  for (const w of plan.writes) fake.docs.set(w.path, w.data);
  return createVerification({
    reader: createSqlVerificationReader(
      fake.db as unknown as Parameters<typeof createSqlVerificationReader>[0],
    ),
    readFile: () => Promise.resolve(null),
  }).view(code, typedName);
};

describe("PPIDK documents import (step 4.10)", () => {
  it("every PPIDK verification code resolves with the same status", async () => {
    expect(await verify("8F3KM-QRTVW")).toMatchObject({
      kind: "letter",
      cancelled: false,
      number: "012/UND/SEKJEN/PPIDK-ASIANIA/VIII/2026",
      content: "shown",
      bodyHtml: expect.stringContaining("surat") as string,
      canDownload: true,
      signers: [
        { name: "Ana Putri", desk: "Sekretariat Jenderal", position: "Sekretaris Jenderal" },
      ],
    });
    // Before signature snapshots: rebuilt from the account, as PPIDK did.
    expect(await verify("ABCDE-FGHJK")).toMatchObject({
      cancelled: true,
      cancelReason: "Salah tanggal",
      canDownload: false,
      signers: [{ name: "Ana", desk: "Sekretariat Jenderal", position: null }],
    });
    expect(await verify("CHNGD-23456", "Arif Nurwahid")).toMatchObject({
      cancelled: false,
      content: "changed",
      bodyHtml: null,
    });
    expect(await verify("SWAPD-22222")).toMatchObject({
      cancelled: false,
      unitName: "PPIDK Asia-Oseania",
      canDownload: false,
    });
    expect(await verify("SHEET-33333")).toMatchObject({
      kind: "certificate",
      cancelled: false,
      number: "001.003/SERT/LKMM/PPIDK-ASIANIA/IX/2026",
      holderName: "Rio",
      note: "Narasumber",
      activity: "LKMM 2026",
      signers: [
        { name: "Rio", desk: "Koordinator PPIDK Asia-Oseania" },
        { name: "Ana", desk: "Sekretaris Jenderal PPIDK Asia-Oseania" },
      ],
    });
    expect(await verify("SHEET-22222")).toMatchObject({
      number: "001.001/SERT/LKMM/PPIDK-ASIANIA/IX/2026",
    });
    // Not issued in PPIDK either: no answer.
    expect(await verify("WAKTS-22222")).toBeNull();
  });

  it("imports letter types with their code pointer and flags patterns the platform refuses", () => {
    expect(doc("letterTypes/ppidk-lettertype-5")).toMatchObject({
      name: "Surat Undangan",
      code: "UND",
      description: "",
      numberPadding: 3,
      requiresCoordinator: false,
      requiresRecipient: true,
      contentPublic: true,
      active: true,
      sort: 1,
      version: 1,
      deletedAt: null,
    });
    expect(doc("letterTypes/ppidk-lettertype-7")).toMatchObject({
      contentPublic: false,
      active: false,
    });
    expect(doc("letterTypeCodes/sket")).toEqual({ id: "ppidk-lettertype-7" });
    expect(doc("letterTypeCodes/sp m")).toBeUndefined();
    expect(reasons).toContain(
      'letter_types/8: code "SP m" is not allowed here: change it on the Letter types page',
    );
    expect(reasons).toContain(
      "letter_types/7: Unknown placeholder {nomer}. Fix the pattern on the Letter types page before the next letter of this type.",
    );
  });

  it("counters continue from the last PPIDK number", () => {
    expect(doc("letterCounters/ppidk-period-3_ppidk-lettertype-5")).toEqual({ last: 12 });
    // No sequence row: the highest number used.
    expect(doc("letterCounters/ppidk-period-3_ppidk-lettertype-7")).toEqual({ last: 2 });
    expect(doc("letterCounters/ppidk-period-3_ppidk-lettertype-6")).toEqual({ last: 1 });
    expect(doc("certificateCounters/ppidk-letter-104")).toEqual({ last: 4 });
    expect(doc("incomingCounters/ppidk-period-3")).toEqual({ last: 41 });
  });

  it("maps statuses, sources, desks and files", () => {
    expect(doc("letters/ppidk-letter-103")).toMatchObject({
      status: "corrected",
      orgUnitPath: ["ppidk-unit-40", "ppidk-unit-41"],
      secretary: null,
      number: null,
      verificationCode: null,
      signers: [],
      archive: null,
    });
    expect(doc("letters/ppidk-letter-104")).toMatchObject({
      source: "certificate",
      activityCode: "LKMM",
      coordinator: { uid: "ppidk-2", at: new Date("2026-09-10T00:30:00Z") },
      sheetNumberTemplate: "001.{sheet:3}/SERT/LKMM/PPIDK-ASIANIA/IX/2026",
    });
    expect(doc("letters/ppidk-letter-100")).toMatchObject({
      archive: { path: "letters/ppidk-period-3/ppidk-letter-100_ppidkpdf.pdf", size: 2048 },
      letterhead: null,
    });
    expect(doc("letters/ppidk-letter-105")).toMatchObject({
      status: "awaiting_file",
      source: "upload",
      archive: null,
      upload: {
        path: "letters/ppidk-period-3/ppidk-letter-105_upload_ppidkpdf.pdf",
        sha256: "b".repeat(64),
        size: 4096,
        numberChecked: true,
        uploadedBy: "firebase-ana",
        uploadedAt: new Date("2026-08-05T00:00:00Z"),
      },
      placement: { qr: null, secretary: { page: 2, xMm: 120, yMm: 240 }, coordinator: null },
    });
    expect(doc("letters/ppidk-letter-106")).toMatchObject({ archive: null, orgUnitPath: [] });
    expect(doc("letters/ppidk-letter-107")).toBeUndefined();
    expect(doc("verificationCodes/ABCDE-FGHJK")).toEqual({
      kind: "letter",
      letterId: "ppidk-letter-101",
      periodId: "ppidk-period-3",
    });
    expect(plan.files.map((f) => f.from)).toEqual([
      "surat/3/100.pdf",
      "surat/3/105.pdf",
      "masuk/300.pdf",
    ]);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "letters/101: file not found: surat/3/101.pdf",
        "letters/106: archive changed since PPIDK stored it (sha256): not imported",
        "letters/106: no issuing unit",
        "letters/107: status arsip",
        "letters/102: stored text no longer matches its PPIDK digest: shown to nobody",
        "certificates/902: batch not imported",
        "certificates/903: verification code 8F3KM-QRTVW is already used",
        "certificates/904: verification code I0I0I-I0I0I cannot be typed on the platform",
        "incoming_letters/301: file not imported (only PDFs): masuk/301.jpg",
        "incoming_letters/302: status ?",
        "letter_dispositions/402: letter not imported",
      ]),
    );
    expect(plan.counts).toMatchObject({ letters: 7, certificates: 2, files: 3 });
  });

  it("imports the agenda book with its disposition chain", () => {
    expect(doc("incomingLetters/ppidk-incoming-300")).toMatchObject({
      periodId: "ppidk-period-3",
      agendaNumber: "041/AG/VIII/2026",
      sender: "KBRI Tokyo",
      originNumber: "B-12/KBRI",
      summary: "",
      status: "disposed",
      recordedBy: "firebase-ana",
      scan: {
        path: "letters/incoming/ppidk-period-3/ppidk-incoming-300_ppidkpdf.pdf",
        name: "300.pdf",
        size: 1024,
        sha256: "d".repeat(64),
      },
      dispositions: [
        {
          id: "ppidk-disposition-400",
          parentId: null,
          fromUserId: "firebase-ana",
          toOrgUnitId: "ppidk-unit-41",
          toUserId: null,
          dueDate: "2026-08-10",
          status: "in_progress",
          response: null,
          completedAt: null,
        },
        {
          id: "ppidk-disposition-401",
          parentId: "ppidk-disposition-400",
          toOrgUnitId: null,
          toUserId: "ppidk-2",
          status: "done",
          response: "Sudah",
          completedAt: new Date("2026-08-03T00:00:00Z"),
        },
      ],
    });
    expect(doc("incomingLetters/ppidk-incoming-301")).toMatchObject({
      status: "archived",
      scan: null,
      recordedBy: "ppidk",
      dispositions: [],
    });
  });
});
