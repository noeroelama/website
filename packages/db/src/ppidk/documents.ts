/**
 * PPIDK → platform import of letters, certificates and the agenda book (block J, step 4.10,
 * DEC-10): pure mapping from the MariaDB tables (exported as TSV) to database documents, run
 * after the people import (periods, units and accounts exist) and after freezing the PPIDK
 * letter screens. Numbers and verification codes are kept AS PRINTED and every counter is set
 * to the last PPIDK number, so the platform never gives out a PPIDK number again. The local
 * script infrastructure/scripts/import-ppidk-documents.mjs reads the files, writes what this
 * returns and copies the archived PDFs. Ids come from PPIDK (idempotent).
 */
import {
  certificateId,
  checkNumberPattern,
  deskLabel,
  letterArchivePath,
  letterCanonical,
  letterUploadPath,
  normalizeVerificationCode,
  scanPath,
  sheetNumberTemplate,
  type Disposition,
  type IncomingStatus,
  type LetterSource,
  type LetterStatus,
  type LetterType,
  type SignerSnapshot,
} from "@website/domain/documents";
import { sha256Hex } from "@website/security";
import { sanitizeRichText } from "@website/security/html";
import type { PlannedWrite, TsvRow } from "./people";
import type { PlannedFile } from "./recruitment";

/** The tables this import reads (one `<name>.tsv` file each). */
export const PPIDK_DOCUMENT_TABLES = [
  "users",
  "org_units",
  "letter_types",
  "letter_sequences",
  "letters",
  "certificates",
  "incoming_letters",
  "incoming_letter_sequences",
  "letter_dispositions",
] as const;
export type PpidkDocumentTables = Readonly<
  Record<(typeof PPIDK_DOCUMENT_TABLES)[number], readonly TsvRow[]>
>;

export interface PpidkDocumentPlan {
  readonly writes: PlannedWrite[];
  readonly files: PlannedFile[];
  readonly skipped: Array<{ table: string; id: string; reason: string }>;
  readonly counts: Record<string, number>;
}

/** A PDF found in the owner's download of PPIDK's storage. */
export interface PpidkFileInfo {
  readonly size: number;
  readonly sha256: string;
}

const LETTER_STATUS: Readonly<Record<string, LetterStatus>> = {
  draft: "draft",
  review: "review",
  terkoreksi: "corrected",
  approved: "approved",
  menunggu_berkas: "awaiting_file",
  issued: "issued",
  cancelled: "cancelled",
};
const SOURCE: Readonly<Record<string, LetterSource>> = {
  editor: "editor",
  unggah: "upload",
  sertifikat: "certificate",
};
const INCOMING_STATUS: Readonly<Record<string, IncomingStatus>> = {
  baru: "new",
  didisposisi: "disposed",
  selesai: "done",
  arsip: "archived",
};
const DISPOSITION_STATUS: Readonly<Record<string, Disposition["status"]>> = {
  menunggu: "waiting",
  diproses: "in_progress",
  selesai: "done",
};
/** Stored file names get this instead of a random part (the same on every run). */
const FIXED = "ppidkpdf";

const at = (value: string | null | undefined) => (value ? new Date(`${value}Z`) : null);
const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const tidy = (value: string) => value.replace(/\r\n?/g, "\n").trim();
const sha = (text: string) => sha256Hex(new TextEncoder().encode(text));

/** PPIDK `SidikSurat::kanonik`: its keys and PPIDK user ids, as frozen there. */
function ppidkCanonical(l: TsvRow, typeCode: string): string {
  return [
    ["nomor", l["number_formatted"] ?? ""],
    ["tanggal", l["letter_date"] ?? ""],
    ["jenis", typeCode],
    ["perihal", tidy(l["subject"] ?? "")],
    ["penerima", tidy(l["recipient"] ?? "")],
    ["badan", tidy(l["body"] ?? "")],
    ["penandatangan", l["signed_by_user_id"] ?? ""],
    ["koordinator", l["coordinator_user_id"] ?? ""],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join("\x1f");
}

interface PpidkSigner {
  nama?: string | null;
  meja?: string | null;
  jabatan?: string | null;
  periode?: string | null;
  waktu?: string | null;
}

export function mapPpidkDocuments(
  tables: PpidkDocumentTables,
  options: {
    uidOf: (ppidkUserId: string) => string;
    /** A real PDF of PPIDK's storage, or null when it is not in the download. */
    file: (ppidkPath: string) => PpidkFileInfo | null;
    now: Date;
  },
): PpidkDocumentPlan {
  const { now } = options;
  const writes: PlannedWrite[] = [];
  const files: PlannedFile[] = [];
  const skipped: PpidkDocumentPlan["skipped"] = [];
  const set = (path: string, data: Record<string, unknown>) =>
    writes.push({ path, data, mode: "set" });
  const skip = (table: string, row: TsvRow, reason: string) =>
    skipped.push({ table, id: row["id"] ?? "", reason });
  const id = (table: string, value: string | null | undefined) => `ppidk-${table}-${value ?? ""}`;
  const person = (ppidkUserId: string | null | undefined) =>
    ppidkUserId ? options.uidOf(ppidkUserId) : null;
  const meta = (row: TsvRow) => ({
    version: 1,
    createdAt: at(row["created_at"]) ?? now,
    updatedAt: now,
    deletedAt: null,
  });
  /** The PDF to copy (only PDFs, only when downloaded), or null with the reason reported. */
  const pdf = (table: string, row: TsvRow, from: string | null | undefined, to: string) => {
    if (!from) return null;
    if (!from.toLowerCase().endsWith(".pdf")) {
      skip(table, row, `file not imported (only PDFs): ${from}`);
      return null;
    }
    const info = options.file(from);
    if (!info) skip(table, row, `file not found: ${from}`);
    return info && { from, to, info };
  };
  const counter = (counters: Map<string, number>, key: string, value: number) =>
    counters.set(key, Math.max(counters.get(key) ?? 0, value));

  /** One code space for letters and certificates (`verificationCodes/{code}`). */
  const codes = new Set<string>();
  const reserveCode = (table: string, row: TsvRow, data: Record<string, unknown>) => {
    const raw = row["verification_code"];
    if (!raw) return null;
    const code = normalizeVerificationCode(raw);
    if (!code) {
      skip(table, row, `verification code ${raw} cannot be typed on the platform`);
      return null;
    }
    if (codes.has(code)) {
      skip(table, row, `verification code ${code} is already used`);
      return null;
    }
    codes.add(code);
    set(`verificationCodes/${code}`, data);
    return code;
  };

  /* ---- org units (names and codes for the numbers and the desks) ---- */
  const units = new Map(tables.org_units.map((u) => [u["id"] ?? "", u]));
  const pathOf = (unitId: string): string[] => {
    const path: string[] = [];
    for (let p = units.get(unitId)?.["parent_id"]; p && !path.includes(id("unit", p));) {
      path.unshift(id("unit", p));
      p = units.get(p)?.["parent_id"];
    }
    return [...path, id("unit", unitId)];
  };
  const userName = new Map(tables.users.map((u) => [u["id"] ?? "", u["name"] ?? u["email"]]));

  /* ---- letter types ---- */
  const types = new Map<
    string,
    Pick<LetterType, "code" | "numberFormat" | "numberPadding" | "requiresCoordinator">
  >();
  for (const t of tables.letter_types) {
    const typeId = id("lettertype", t["id"]);
    const code = (t["code"] ?? "").trim();
    const type = {
      name: (t["name"] ?? "").slice(0, 120),
      code,
      description: t["description"] ?? "",
      numberFormat: t["number_format"] ?? "",
      numberPadding: Number(t["number_padding"] ?? 3),
      requiresCoordinator: t["requires_coordinator"] === "1",
      requiresRecipient: t["requires_recipient"] !== "0",
      contentPublic: t["content_public"] !== "0",
      active: t["is_active"] !== "0",
      sort: Number(t["sort"] ?? 0),
    };
    types.set(t["id"] ?? "", type);
    const problem = checkNumberPattern(type.numberFormat);
    if (problem) {
      skip(
        "letter_types",
        t,
        `${problem} Fix the pattern on the Letter types page before the next letter of this type.`,
      );
    }
    set(`letterTypes/${typeId}`, { ...type, ...meta(t) });
    if (/^[A-Za-z0-9-]{1,12}$/.test(code)) {
      set(`letterTypeCodes/${code.toLowerCase()}`, { id: typeId });
    } else {
      skip(
        "letter_types",
        t,
        `code "${code}" is not allowed here: change it on the Letter types page`,
      );
    }
  }

  /* ---- letters (outgoing, upload path and certificate batches) ---- */
  const letterCounters = new Map<string, number>();
  for (const s of tables.letter_sequences) {
    counter(
      letterCounters,
      `${id("period", s["period_id"])}_${id("lettertype", s["letter_type_id"])}`,
      Number(s["last_number"] ?? 0),
    );
  }
  const batches = new Map<string, { periodId: string }>();
  for (const l of tables.letters) {
    const status = LETTER_STATUS[l["status"] ?? ""];
    const type = types.get(l["letter_type_id"] ?? "");
    if (!status || !type) {
      skip("letters", l, status ? "letter type not imported" : `status ${l["status"] ?? ""}`);
      continue;
    }
    const letterId = id("letter", l["id"]);
    const periodId = id("period", l["period_id"]);
    const typeId = id("lettertype", l["letter_type_id"]);
    const source = SOURCE[l["sumber"] ?? ""] ?? "editor";
    const unit = units.get(l["org_unit_id"] ?? "");
    if (!unit) skip("letters", l, "no issuing unit");
    const number = l["number"] ? Number(l["number"]) : null;
    if (number !== null) counter(letterCounters, `${periodId}_${typeId}`, number);
    const desk = (user: string | null | undefined, signedAt: string | null | undefined) => {
      const uid = person(user);
      const when = at(signedAt);
      return uid && when ? { uid, at: when } : null;
    };
    const secretary = desk(l["signed_by_user_id"], l["approved_at"]);
    const coordinator = desk(l["coordinator_user_id"], l["coordinator_approved_at"]);
    const issuedAt = at(l["issued_at"]);
    const snapshot = json<PpidkSigner[] | null>(l["signature_snapshot"], null);
    // Letters issued before PPIDK froze signers: rebuilt from the accounts, as PPIDK's page did.
    const signers: SignerSnapshot[] = Array.isArray(snapshot)
      ? snapshot.map((s) => ({
          name: s.nama ?? "",
          desk: s.meja ?? "",
          position: s.jabatan ?? null,
          period: s.periode ?? null,
          at: (s.waktu ? new Date(s.waktu) : null) ?? issuedAt ?? now,
        }))
      : number === null
        ? []
        : (
            [
              ["coordinator", l["coordinator_user_id"], coordinator],
              ["secretary", l["signed_by_user_id"], secretary],
            ] as const
          ).flatMap(([d, user, signed]) =>
            signed
              ? [
                  {
                    name: userName.get(user ?? "") ?? "",
                    desk: deskLabel(d, type as LetterType, unit?.["name"] ?? null),
                    position: null,
                    period: null,
                    at: signed.at,
                  },
                ]
              : [],
          );

    // The archived PDF: an upload waiting for issue is the upload, anything else the archive.
    const waiting = status === "awaiting_file";
    const where = { id: letterId, periodId };
    let file = pdf(
      "letters",
      l,
      l["pdf_path"],
      waiting ? letterUploadPath(where, FIXED) : letterArchivePath(where, FIXED),
    );
    if (file && l["berkas_sha256"] && file.info.sha256 !== l["berkas_sha256"]) {
      skip("letters", l, "archive changed since PPIDK stored it (sha256): not imported");
      file = null;
    }
    if (file) files.push({ from: file.from, to: file.to, contentType: "application/pdf" });
    const stored = file && { path: file.to, sha256: file.info.sha256, size: file.info.size };
    const placement = json<{ halaman?: number; x_mm?: number; y_mm?: number } | null>(
      l["penempatan_ttd"],
      null,
    );

    const letter = {
      periodId,
      typeId,
      orgUnitId: unit ? id("unit", unit["id"]) : id("unit", "none"),
      orgUnitPath: unit ? pathOf(unit["id"] ?? "") : [],
      subject: l["subject"] ?? "",
      body: sanitizeRichText(l["body"] ?? ""),
      recipient: l["recipient"] ?? "",
      place: l["place"] ?? "",
      attachmentNote: l["attachment_note"] ?? "",
      letterDate: l["letter_date"] ?? null,
      status,
      source,
      createdBy: person(l["created_by_user_id"]) ?? "ppidk",
      reviewedBy: person(l["reviewed_by_user_id"]),
      reviewNote: null,
      secretary,
      coordinator,
      number,
      numberFormatted: l["number_formatted"] ?? null,
      verificationCode: null as string | null,
      issuedAt,
      cancelledAt: at(l["cancelled_at"]),
      cancelReason: l["cancel_reason"] ?? null,
      contentDigest: null as string | null,
      signers,
      letterhead: null,
      archive: waiting ? null : stored,
      upload:
        waiting && stored
          ? {
              ...stored,
              numberChecked:
                json<{ unggahan?: { nomor_diperiksa?: boolean } }>(l["meta"], {}).unggahan
                  ?.nomor_diperiksa === true,
              uploadedBy: person(l["created_by_user_id"]) ?? "ppidk",
              uploadedAt: at(l["berkas_diunggah_pada"]) ?? now,
            }
          : null,
      placement:
        waiting && placement
          ? {
              qr: null,
              secretary: {
                page: Number(placement.halaman ?? 1),
                xMm: Number(placement.x_mm ?? 130),
                yMm: Number(placement.y_mm ?? 230),
              },
              coordinator: null,
            }
          : null,
      activityCode: l["kode_kegiatan"] ? l["kode_kegiatan"].trim().toUpperCase() : null,
      sheetNumberTemplate: null as string | null,
      ...meta(l),
    };
    letter.verificationCode = reserveCode("letters", l, {
      kind: "letter",
      letterId,
      periodId,
    });
    if (source === "certificate" && number !== null) {
      batches.set(l["id"] ?? "", { periodId });
      try {
        letter.sheetNumberTemplate = sheetNumberTemplate(type.numberFormat, {
          seq: number,
          padding: type.numberPadding,
          typeCode: type.code,
          unitCode: unit?.["code"] ?? null,
          activityCode: letter.activityCode,
          date: letter.letterDate ?? now.toISOString().slice(0, 10),
        });
      } catch {
        skip("letters", l, "sheet numbers cannot be built from the type's pattern");
      }
    }
    // Same status as PPIDK: a digest that matched there is re-frozen in the platform's form; one
    // that no longer matched stays as it is (content shown to nobody); none stays none.
    if (l["content_digest"]) {
      const intact = sha(ppidkCanonical(l, type.code)) === l["content_digest"];
      if (!intact)
        skip("letters", l, "stored text no longer matches its PPIDK digest: shown to nobody");
      letter.contentDigest = intact
        ? sha(letterCanonical({ ...letter, id: letterId }, type.code))
        : l["content_digest"];
    }
    set(`letters/${letterId}`, letter);
  }
  for (const [key, last] of letterCounters) set(`letterCounters/${key}`, { last });

  /* ---- certificate sheets ---- */
  const sheetCounters = new Map<string, number>();
  for (const c of tables.certificates) {
    const batch = batches.get(c["letter_id"] ?? "");
    if (!batch) {
      skip("certificates", c, "batch not imported");
      continue;
    }
    const batchId = id("letter", c["letter_id"]);
    const seq = Number(c["urut"]);
    // A printed sequence is used even when its sheet cannot be imported.
    counter(sheetCounters, batchId, seq);
    const sheetId = certificateId(batchId, seq);
    const code = reserveCode("certificates", c, {
      kind: "certificate",
      letterId: batchId,
      certificateId: sheetId,
      periodId: batch.periodId,
    });
    if (!code) continue;
    set(`certificates/${sheetId}`, {
      batchId,
      periodId: batch.periodId,
      seq,
      name: c["nama"] ?? "",
      note: c["keterangan"] ?? null,
      verificationCode: code,
      // PPIDK kept no e-mail per sheet: these sheets are not on the pickup page.
      emailHash: null,
      createdAt: at(c["created_at"]) ?? now,
    });
  }
  for (const [batchId, last] of sheetCounters) set(`certificateCounters/${batchId}`, { last });

  /* ---- agenda book (incoming letters) and dispositions ---- */
  const incomingCounters = new Map<string, number>();
  for (const s of tables.incoming_letter_sequences) {
    counter(incomingCounters, id("period", s["period_id"]), Number(s["last_number"] ?? 0));
  }
  const imported = new Set<string>();
  const dispositionsOf = new Map<string, Disposition[]>();
  for (const i of tables.incoming_letters) imported.add(i["id"] ?? "");
  for (const d of [...tables.letter_dispositions].sort(
    (a, b) => Number(a["id"]) - Number(b["id"]),
  )) {
    const status = DISPOSITION_STATUS[d["status"] ?? ""];
    if (!imported.has(d["incoming_letter_id"] ?? "") || !status) {
      skip(
        "letter_dispositions",
        d,
        status ? "letter not imported" : `status ${d["status"] ?? ""}`,
      );
      continue;
    }
    const list = dispositionsOf.get(d["incoming_letter_id"] ?? "") ?? [];
    list.push({
      id: id("disposition", d["id"]),
      parentId: d["parent_id"] ? id("disposition", d["parent_id"]) : null,
      fromUserId: person(d["from_user_id"]) ?? "ppidk",
      toOrgUnitId: d["to_org_unit_id"] ? id("unit", d["to_org_unit_id"]) : null,
      toUserId: person(d["to_user_id"]),
      instruction: d["instruction"] ?? "",
      dueDate: d["due_date"] ?? null,
      status,
      response: d["response"] ?? null,
      createdAt: at(d["created_at"]) ?? now,
      completedAt: at(d["completed_at"]),
    });
    dispositionsOf.set(d["incoming_letter_id"] ?? "", list);
  }
  for (const i of tables.incoming_letters) {
    const status = INCOMING_STATUS[i["status"] ?? ""];
    if (!status) {
      skip("incoming_letters", i, `status ${i["status"] ?? ""}`);
      continue;
    }
    const letterId = id("incoming", i["id"]);
    const periodId = id("period", i["period_id"]);
    const agenda = i["agenda_number"] ?? "";
    counter(incomingCounters, periodId, Number.parseInt(agenda, 10) || 0);
    const scan = pdf("incoming_letters", i, i["file_path"], scanPath(periodId, letterId, FIXED));
    if (scan) files.push({ from: scan.from, to: scan.to, contentType: "application/pdf" });
    set(`incomingLetters/${letterId}`, {
      periodId,
      agendaNumber: agenda,
      sender: i["sender"] ?? "",
      originNumber: i["origin_number"] ?? "",
      subject: i["subject"] ?? "",
      letterDate: i["letter_date"] ?? null,
      receivedDate: i["received_date"] ?? "",
      summary: i["summary"] ?? "",
      status,
      scan: scan && {
        path: scan.to,
        name: scan.from.split("/").pop() ?? "scan.pdf",
        size: scan.info.size,
        sha256: scan.info.sha256,
      },
      recordedBy: person(i["recorded_by_user_id"]) ?? "ppidk",
      dispositions: dispositionsOf.get(i["id"] ?? "") ?? [],
      ...meta(i),
    });
  }
  for (const [periodId, last] of incomingCounters) set(`incomingCounters/${periodId}`, { last });

  const counts: Record<string, number> = {};
  for (const w of writes) {
    const collection = w.path.split("/")[0] ?? "";
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  counts["files"] = files.length;
  return { writes, files, skipped, counts };
}
