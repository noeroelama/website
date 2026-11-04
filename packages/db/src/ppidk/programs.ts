/**
 * PPIDK → platform import of OKR, work programmes, check-ins, LPJ and finance (block J, step 6.7,
 * DEC-10): pure mapping from the MariaDB tables (exported as TSV) to database documents, run after
 * the people import (periods, units and accounts exist) and after freezing the PPIDK proker and
 * finance screens. Progress is recomputed with the platform rule, the LPJ plan is frozen with the
 * platform's `openLpj`, and paid requests write their cash book line with `cashEntryFromRequest`,
 * so imported documents follow the same rules as new ones. The local script
 * infrastructure/scripts/import-ppidk-programs.mjs reads the files, writes what this returns and
 * copies the private PDFs. Ids come from PPIDK (idempotent).
 */
import {
  cashEntryFromRequest,
  financeFilePath,
  type CashCategory,
  type CashEntry,
  type CashKind,
  type DeskStamp,
  type FinanceCategory,
  type FinanceFile,
  type FinanceRequest,
  type FinanceStatus,
} from "@website/domain/finance";
import {
  checkinId,
  DEFAULT_LPJ_DEADLINE_DAYS,
  openLpj,
  weekStartUtc,
  withProgress,
  type HealthStatus,
  type KeyResult,
  type LpjStatus,
  type Milestone,
  type Program,
  type ProgramStatus,
} from "@website/domain/programs";
import { toMinor, type Money } from "@website/domain/shared";
import type { PpidkFileInfo } from "./documents";
import type { PlannedWrite, TsvRow } from "./people";
import type { PlannedFile } from "./recruitment";

/** The tables this import reads (one `<name>.tsv` file each). */
export const PPIDK_PROGRAM_TABLES = [
  "org_units",
  "objectives",
  "key_results",
  "programs",
  "program_members",
  "program_milestones",
  "program_checkins",
  "program_reports",
  "keuangan_pengajuan",
  "keuangan_transaksi",
] as const;
export type PpidkProgramTables = Readonly<
  Record<(typeof PPIDK_PROGRAM_TABLES)[number], readonly TsvRow[]>
>;

export interface PpidkProgramPlan {
  readonly writes: PlannedWrite[];
  readonly files: PlannedFile[];
  readonly skipped: Array<{ table: string; id: string; reason: string }>;
  readonly counts: Record<string, number>;
}

const PROGRAM_STATUS: Readonly<Record<string, ProgramStatus>> = {
  usulan: "proposed",
  disetujui: "approved",
  berjalan: "running",
  selesai: "finished",
  dibatalkan: "cancelled",
};
const HEALTH: Readonly<Record<string, HealthStatus>> = {
  on_track: "on_track",
  at_risk: "at_risk",
  off_track: "off_track",
};
const DIRECTION: Readonly<Record<string, KeyResult["direction"]>> = { naik: "up", turun: "down" };
const LPJ_STATUS: Readonly<Record<string, LpjStatus>> = {
  draft: "draft",
  diajukan: "submitted",
  revisi: "returned",
  disetujui: "approved",
};
const FINANCE_STATUS: Readonly<Record<string, FinanceStatus>> = {
  draft: "draft",
  diajukan: "submitted",
  direview: "reviewed",
  disetujui: "authorized",
  dicairkan: "paid",
  selesai: "done",
  revisi: "revision",
  ditolak: "rejected",
};
const FINANCE_CATEGORY: Readonly<Record<string, FinanceCategory>> = {
  penerimaan: "receipt",
  pencairan: "disbursement",
  reimburse: "reimbursement",
  anggaran: "budget",
};
/** `jenis/kategori` → cash book kind and category (PPIDK `KATEGORI_MASUK` / `KATEGORI_KELUAR`). */
const CASH_LINE: Readonly<Record<string, { kind: CashKind; category: CashCategory }>> = {
  "masuk/saldo_awal": { kind: "in", category: "opening_balance" },
  "masuk/iuran": { kind: "in", category: "dues" },
  "masuk/donasi": { kind: "in", category: "donation" },
  "masuk/penerimaan": { kind: "in", category: "receipt" },
  "masuk/bunga": { kind: "in", category: "interest" },
  "masuk/lain": { kind: "in", category: "other_in" },
  "keluar/kegiatan": { kind: "out", category: "activity" },
  "keluar/operasional": { kind: "out", category: "operational" },
  "keluar/reimburse": { kind: "out", category: "reimbursement" },
  "keluar/pencairan": { kind: "out", category: "disbursement" },
  "keluar/lain": { kind: "out", category: "other_out" },
};
/** Programme plan fields the platform has no own field for: kept as lines of the description. */
const PLAN_EXTRAS = [
  ["Target audience", "target_audience"],
  ["Indicator", "indicator"],
  ["Indicator baseline", "indicator_baseline"],
  ["Indicator target", "indicator_target"],
  ["Activity", "activity_form"],
  ["Location", "location"],
  ["Partners", "partners"],
] as const;
/** PPIDK finance is in IDR only (its migration has no currency column). */
const IDR = "IDR";

const at = (value: string | null | undefined) => (value ? new Date(`${value}Z`) : null);
const json = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return (JSON.parse(value as string) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};
/** PPIDK decimal(15,2) → minor units of the currency ("50000.00" JPY → 50000), or null. */
const minorOf = (value: string, currency: string): number | null =>
  /^[A-Z]{3}$/.test(currency)
    ? toMinor(value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""), currency)
    : null;

export function mapPpidkPrograms(
  tables: PpidkProgramTables,
  options: {
    uidOf: (ppidkUserId: string) => string;
    /** A real PDF of PPIDK's storage, or null when it is not in the download. */
    file: (ppidkPath: string) => PpidkFileInfo | null;
    now: Date;
  },
): PpidkProgramPlan {
  const { now } = options;
  const writes: PlannedWrite[] = [];
  const files: PlannedFile[] = [];
  const skipped: PpidkProgramPlan["skipped"] = [];
  const set = (path: string, data: Record<string, unknown>) =>
    writes.push({ path, data, mode: "set" });
  const skip = (table: string, row: TsvRow, reason: string) =>
    skipped.push({ table, id: row["id"] as string, reason });
  const id = (table: string, value: string | null | undefined) => `ppidk-${table}-${String(value)}`;
  const person = (ppidkUserId: string | null | undefined) =>
    ppidkUserId ? options.uidOf(ppidkUserId) : null;
  /** PPIDK did not record who did it (or the account is gone). */
  const who = (ppidkUserId: string | null | undefined) => person(ppidkUserId) ?? "ppidk";
  const meta = (row: TsvRow) => ({
    version: 1,
    createdAt: at(row["created_at"]) ?? now,
    updatedAt: now,
    deletedAt: null,
  });
  const amount = (table: string, row: TsvRow, value: string, currency: string, what: string) => {
    const minor = minorOf(value, currency);
    if (minor === null) skip(table, row, `${what} not imported: ${value} ${currency}`);
    return minor;
  };
  /** A downloaded PDF copied to `to`, or null with the reason reported. */
  const pdf = (table: string, row: TsvRow, from: string, to: string): FinanceFile | null => {
    if (!from.toLowerCase().endsWith(".pdf")) {
      skip(table, row, `file not imported (only PDFs): ${from}`);
      return null;
    }
    const info = options.file(from);
    if (!info) {
      skip(table, row, `file not found: ${from}`);
      return null;
    }
    files.push({ from, to, contentType: "application/pdf" });
    return { path: to, name: from.split("/").pop() as string, ...info };
  };

  /* ---- org units (paths for scope checks) ---- */
  const units = new Map(tables.org_units.map((u) => [u["id"] as string, u]));
  /** `orgUnitPath` of an imported unit, or null when the unit is not in the export. */
  const unitPath = (unitId: string): string[] | null => {
    const path: string[] = [];
    for (
      let u = units.get(unitId);
      u && !path.includes(id("unit", u["id"]));
      u = units.get(u["parent_id"] as string)
    ) {
      path.unshift(id("unit", u["id"]));
    }
    return path.length > 0 ? path : null;
  };

  /* ---- OKR: objectives with their key results inside ---- */
  const keyResults = new Map<string, KeyResult[]>();
  const objectiveOf = new Map<string, string>();
  const objectiveIds = new Set(tables.objectives.map((o) => o["id"]));
  for (const k of tables.key_results) {
    const direction = DIRECTION[k["direction"] as string];
    if (!objectiveIds.has(k["objective_id"]) || !direction) {
      skip("key_results", k, direction ? "objective not imported" : `direction ${k["direction"]}`);
      continue;
    }
    const list = keyResults.get(k["objective_id"] as string) ?? [];
    list.push({
      id: id("keyresult", k["id"]),
      title: k["title"] as string,
      unit: k["unit"] ?? "",
      baseline: Number(k["baseline"]),
      target: Number(k["target"]),
      current: Number(k["current_value"]),
      direction,
      sort: Number(k["sort"]),
      measuredAt: at(k["measured_at"]),
    });
    keyResults.set(k["objective_id"] as string, list);
    objectiveOf.set(k["id"] as string, k["objective_id"] as string);
  }
  for (const o of tables.objectives) {
    const unitId = o["org_unit_id"];
    const path = unitId ? unitPath(unitId) : [];
    if (!path) {
      skip("objectives", o, "unit not imported");
      continue;
    }
    set(`objectives/${id("objective", o["id"])}`, {
      periodId: id("period", o["period_id"]),
      orgUnitId: unitId ? id("unit", unitId) : null,
      orgUnitPath: path,
      title: o["title"],
      description: o["description"] ?? "",
      sort: Number(o["sort"]),
      keyResults: [...(keyResults.get(o["id"] as string) ?? [])].sort((a, b) => a.sort - b.sort),
      ...meta(o),
    });
  }

  /* ---- programmes, PICs, milestones ---- */
  const picsOf = new Map<string, string[]>();
  const milestonesOf = new Map<string, Milestone[]>();
  const programRows = new Map(tables.programs.map((r) => [r["id"] as string, r]));
  for (const r of tables.programs)
    picsOf.set(r["id"] as string, r["pic_user_id"] ? [who(r["pic_user_id"])] : []);
  for (const m of tables.program_members) {
    const pics = picsOf.get(m["program_id"] as string);
    if (!pics) {
      skip("program_members", m, "programme not imported");
      continue;
    }
    const uid = who(m["user_id"]);
    if (!pics.includes(uid)) pics.push(uid);
  }
  for (const m of tables.program_milestones) {
    if (!programRows.has(m["program_id"] as string)) {
      skip("program_milestones", m, "programme not imported");
      continue;
    }
    const list = milestonesOf.get(m["program_id"] as string) ?? [];
    const weight = Math.min(100, Math.max(1, Number(m["weight"])));
    if (String(weight) !== m["weight"]) {
      skip("program_milestones", m, `weight ${m["weight"]} changed to ${weight}`);
    }
    list.push({
      id: id("milestone", m["id"]),
      title: m["title"] as string,
      dueOn: m["due_date"] ?? null,
      weight,
      sort: Math.min(999, Number(m["sort"])),
      completedAt: at(m["completed_at"]),
      completedBy: person(m["completed_by_user_id"]),
    });
    milestonesOf.set(m["program_id"] as string, list);
  }

  const programs = new Map<string, Program>();
  for (const r of tables.programs) {
    const status = PROGRAM_STATUS[r["status"] as string];
    const path = unitPath(r["org_unit_id"] as string);
    if (!status || !path) {
      skip("programs", r, status ? "unit not imported" : `status ${r["status"]}`);
      continue;
    }
    const programId = id("program", r["id"]);
    const objective = objectiveOf.get(r["key_result_id"] as string);
    if (r["key_result_id"] && !objective) skip("programs", r, "key result not imported");
    const budget = r["budget_estimate"]
      ? amount("programs", r, r["budget_estimate"], r["budget_currency"] as string, "budget")
      : null;
    const risks = json<Array<{ risiko: string; mitigasi: string }>>(r["risks"], []);
    const extras = [
      ...PLAN_EXTRAS.filter(([, column]) => r[column]).map(
        ([label, column]) => `${label}: ${r[column]}`,
      ),
      ...risks.map((x) => `Risk: ${x.risiko} (mitigation: ${x.mitigasi})`),
    ];
    const health = HEALTH[r["health"] as string];
    const program = withProgress(
      {
        id: programId,
        periodId: id("period", r["period_id"]),
        orgUnitId: id("unit", r["org_unit_id"]),
        orgUnitPath: path,
        objectiveId: objective ? id("objective", objective) : null,
        keyResultId: objective ? id("keyresult", r["key_result_id"]) : null,
        name: r["name"] as string,
        goal: r["goal"] ?? "",
        description: [r["background"], extras.join("\n")]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000),
        plannedStart: r["planned_start"] ?? null,
        plannedEnd: r["planned_end"] ?? null,
        budgets:
          budget === null
            ? []
            : [{ amountMinor: budget, currency: r["budget_currency"] as string }],
        pics: picsOf.get(r["id"] as string) as string[],
        status,
        progressPercent: 0,
        milestones: [],
        health: health
          ? {
              status: health,
              reason: r["health_reason"] ?? "",
              at: at(r["health_updated_at"]) ?? now,
              by: "ppidk",
            }
          : null,
        reviewNote: r["review_note"] ?? null,
        approvedBy: person(r["approved_by_user_id"]),
        approvedAt: at(r["approved_at"]),
        startedAt: at(r["started_at"]),
        finishedAt: at(r["completed_at"]),
        cancelledAt: at(r["cancelled_at"]),
        cancelReason: r["cancel_reason"] ?? null,
        createdBy: "ppidk",
        ...meta(r),
      },
      milestonesOf.get(r["id"] as string) ?? [],
    );
    if (program.progressPercent !== Number(r["progress_percent"])) {
      skip(
        "programs",
        r,
        `progress recomputed from the milestones: ${r["progress_percent"]} → ${program.progressPercent}`,
      );
    }
    programs.set(r["id"] as string, program);
    set(`programs/${programId}`, withoutId(program));
  }

  /* ---- weekly check-ins: one per programme per UTC week ---- */
  const weeks = new Set<string>();
  for (const c of tables.program_checkins) {
    const program = programs.get(c["program_id"] as string);
    if (!program) {
      skip("program_checkins", c, "programme not imported");
      continue;
    }
    const weekStart = weekStartUtc(new Date(`${c["week_start"]}T00:00:00Z`));
    const checkin = checkinId(program.id, weekStart);
    if (weeks.has(checkin)) {
      skip("program_checkins", c, `week ${weekStart} already has a check-in`);
      continue;
    }
    weeks.add(checkin);
    set(`programCheckins/${checkin}`, {
      programId: program.id,
      periodId: program.periodId,
      weekStart,
      userId: who(c["user_id"]),
      achievements: c["achievements"],
      blockers: c["blockers"] ?? "",
      nextPlan: c["next_plan"] ?? "",
      createdAt: at(c["created_at"]) ?? now,
      updatedAt: now,
    });
  }

  /* ---- LPJ: the plan frozen by the platform rule, the PPIDK text and desks ---- */
  for (const l of tables.program_reports) {
    const status = LPJ_STATUS[l["status"] as string];
    const program = programs.get(l["program_id"] as string);
    if (!status || program?.status !== "finished") {
      skip(
        "program_reports",
        l,
        status ? "programme not imported or not finished" : `status ${l["status"]}`,
      );
      continue;
    }
    const row = programRows.get(l["program_id"] as string) as TsvRow;
    const finishedAt = program.finishedAt ?? now;
    const fields = openLpj(
      { ...program, finishedAt },
      (units.get(row["org_unit_id"] as string) as TsvRow)["name"] as string,
      DEFAULT_LPJ_DEADLINE_DAYS,
      finishedAt,
    );
    const desk = (user: string | null | undefined, signedAt: string | null | undefined) => {
      const uid = person(user);
      const when = at(signedAt);
      return uid && when ? { uid, at: when } : null;
    };
    const links = json<Array<{ label: string; url: string }>>(l["documentation_links"], []);
    const realized = l["realized_amount"]
      ? amount(
          "program_reports",
          l,
          l["realized_amount"],
          l["realized_currency"] as string,
          "money spent",
        )
      : null;
    set(`lpjReports/${program.id}`, {
      ...fields,
      // PPIDK's LPJ text has no own place for testimonials and links: kept in the realization.
      realization: [
        l["realization"],
        l["testimonials"] && `Testimonials:\n${l["testimonials"]}`,
        links.length > 0 &&
          `Documentation:\n${links.map((x) => `- ${x.label}: ${x.url}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      obstacles: l["obstacles"] ?? "",
      recommendations: l["recommendations"] ?? "",
      participantCount: l["participant_count"] ? Number(l["participant_count"]) : null,
      realized:
        realized === null
          ? null
          : [{ amountMinor: realized, currency: l["realized_currency"] as string } satisfies Money],
      dueOn: row["lpj_deadline"] ?? fields.dueOn,
      status,
      submittedBy: person(l["submitted_by_user_id"]),
      submittedAt: at(l["submitted_at"]),
      returnNote: l["revision_note"] ?? null,
      revisionRound: Number(l["revision_round"]),
      secretariat: desk(l["secretary_reviewed_by_user_id"], l["secretary_reviewed_at"]),
      treasurer: desk(l["treasurer_reviewed_by_user_id"], l["treasurer_reviewed_at"]),
      approval: desk(l["approved_by_user_id"], l["approved_at"]),
      ...meta(l),
    });
  }

  /* ---- finance requests (and the cash book line of the paid ones) ---- */
  const requests = new Set<string>();
  for (const r of tables.keuangan_pengajuan) {
    const status = FINANCE_STATUS[r["status"] as string];
    const category = FINANCE_CATEGORY[r["kategori"] as string];
    const path = unitPath(r["org_unit_id"] as string);
    if (!status || !category || !path) {
      skip(
        "keuangan_pengajuan",
        r,
        !status
          ? `status ${r["status"]}`
          : !category
            ? `category ${r["kategori"]}`
            : "unit not imported",
      );
      continue;
    }
    const nominal = amount("keuangan_pengajuan", r, r["nominal"] as string, IDR, "amount");
    if (nominal === null) continue;
    const where = { id: id("finance", r["id"]), periodId: id("period", r["period_id"]) };
    const program = programs.get(r["program_id"] as string);
    const linked = program?.periodId === where.periodId ? program.id : null;
    if (r["program_id"] && !linked)
      skip("keuangan_pengajuan", r, "programme not imported, not linked");
    const stamp = (
      user: string | null | undefined,
      signedAt: string | null | undefined,
      note: string | null | undefined,
    ): DeskStamp | null => {
      const uid = person(user);
      const when = at(signedAt);
      return uid && when ? { uid, at: when, note: note ?? null } : null;
    };
    const documents = json<string[]>(r["dokumen"], [])
      .map((from, i) =>
        pdf(
          "keuangan_pengajuan",
          r,
          from,
          financeFilePath(where, "doc", `ppidk${String(i).padStart(3, "0")}`),
        ),
      )
      .filter((d): d is FinanceFile => d !== null);
    const [proofFrom, ...extra] = json<string[]>(r["bukti_transfer"], []);
    for (const from of extra) {
      skip("keuangan_pengajuan", r, `proof of transfer not imported (one per request): ${from}`);
    }
    const disbursedAt = at(r["disbursed_at"]);
    const updatedAt = at(r["updated_at"]) ?? now;
    const request: FinanceRequest = {
      ...where,
      orgUnitId: id("unit", r["org_unit_id"]),
      orgUnitPath: path,
      category,
      title: r["nama_kegiatan"] as string,
      description: r["deskripsi"] ?? "",
      amountMinor: nominal,
      currency: IDR,
      date: r["tanggal"] ?? null,
      account: r["rekening_tujuan"] ?? "",
      fundSource: r["sumber_dana"] ?? "",
      programId: linked,
      status,
      createdBy: who(r["created_by_user_id"]),
      documents,
      // PPIDK kept no submission time.
      submittedAt: null,
      treasurer: stamp(
        r["treasurer_reviewed_by_user_id"],
        r["treasurer_reviewed_at"],
        r["catatan_review"],
      ),
      coordinator: stamp(
        r["coordinator_approved_by_user_id"],
        r["coordinator_approved_at"],
        r["catatan_koordinator"],
      ),
      revisionNote: r["revision_note"] ?? null,
      revisionRound: Number(r["revision_round"]),
      // PPIDK kept the reason, not who rejected it nor when (its last change is used).
      rejection:
        status === "rejected"
          ? { uid: "ppidk", at: updatedAt, note: r["catatan_koordinator"] as string }
          : null,
      payment: disbursedAt && {
        uid: who(r["disbursed_by_user_id"]),
        at: disbursedAt,
        amountMinor:
          (r["disbursed_amount"]
            ? amount("keuangan_pengajuan", r, r["disbursed_amount"], IDR, "amount paid")
            : null) ?? nominal,
        // A proof not in the download: the platform's placeholder, never served.
        proof: (proofFrom &&
          pdf("keuangan_pengajuan", r, proofFrom, financeFilePath(where, "proof", "ppidkpdf"))) || {
          path: "",
          name: "",
          size: 0,
          sha256: "",
        },
      },
      doneAt: status === "done" ? updatedAt : null,
      ...meta(r),
    };
    requests.add(r["id"] as string);
    set(`financeRequests/${request.id}`, withoutId(request));
    const line = cashEntryFromRequest(request);
    if (line) set(`cashEntries/${line.id}`, withoutId(line));
  }

  /* ---- manual cash book lines (lines of paid requests come from the request) ---- */
  for (const t of tables.keuangan_transaksi) {
    if (t["pengajuan_id"]) {
      if (!requests.has(t["pengajuan_id"])) skip("keuangan_transaksi", t, "request not imported");
      continue;
    }
    const line = CASH_LINE[`${String(t["jenis"])}/${String(t["kategori"])}`];
    if (!line) {
      skip("keuangan_transaksi", t, `category ${t["kategori"]}`);
      continue;
    }
    const value = amount("keuangan_transaksi", t, t["nominal"] as string, IDR, "amount");
    if (value === null) continue;
    const where = { id: id("cash", t["id"]), periodId: id("period", t["period_id"]) };
    const [proofFrom] = json<string[]>(t["bukti"], []);
    const entry: CashEntry = {
      ...where,
      orgUnitId: t["org_unit_id"] ? id("unit", t["org_unit_id"]) : null,
      date: t["tanggal"] as string,
      ...line,
      description: t["uraian"] as string,
      amountMinor: value,
      currency: IDR,
      source: "manual",
      requestId: null,
      proof: proofFrom
        ? pdf("keuangan_transaksi", t, proofFrom, financeFilePath(where, "proof", "ppidkpdf"))
        : null,
      createdBy: who(t["created_by_user_id"]),
      createdAt: at(t["created_at"]) ?? now,
    };
    set(`cashEntries/${entry.id}`, withoutId(entry));
  }

  const counts: Record<string, number> = {};
  for (const w of writes) {
    const collection = w.path.split("/")[0] as string;
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  counts["files"] = files.length;
  return { writes, files, skipped, counts };
}

/** The document as the stores keep it (the id is the document id, not a field). */
const withoutId = (value: { id: string }): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"));
