import { describe, expect, it } from "vitest";
import {
  createSqlFinanceStore,
  createSqlLpjStore,
  createSqlObjectiveStore,
  createSqlPeriodReport,
  createSqlProgramStore,
} from "@website/db/sql";
import { cashReport } from "@website/domain/finance";
import { objectivePercent } from "@website/domain/programs";
import { parseTsv } from "../../packages/db/src/ppidk/people";
import { mapPpidkPrograms, type PpidkProgramTables } from "../../packages/db/src/ppidk/programs";
import { fakeDb } from "../support/fake-db";

const now = new Date("2026-11-04T00:00:00Z");
const table = (rows: Array<Record<string, string>>) => {
  const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (value: string | undefined) =>
    value === undefined ? "NULL" : value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return parseTsv(
    [header.join("\t"), ...rows.map((r) => header.map((h) => cell(r[h])).join("\t"))].join("\n") +
      "\n",
  );
};

const p = { period_id: "3", org_unit_id: "40", created_at: "2026-08-10 00:00:00" };
const f = { period_id: "3", org_unit_id: "41", created_by_user_id: "1", nominal: "100000.00" };

const tables: PpidkProgramTables = {
  org_units: table([
    { id: "40", period_id: "3", name: "Sekretariat Jenderal" },
    { id: "41", period_id: "3", parent_id: "40", name: "Biro Kesekretariatan" },
  ]),
  objectives: table([
    { id: "10", period_id: "3", org_unit_id: "41", title: "Anggota aktif", sort: "1" },
    { id: "11", period_id: "3", title: "Kawasan", description: "Bersama" },
    { id: "12", period_id: "3", org_unit_id: "99", title: "Unit hilang" },
  ]),
  key_results: table([
    {
      id: "20",
      objective_id: "10",
      title: "Peserta",
      unit: "orang",
      baseline: "0.00",
      target: "100.00",
      current_value: "50.00",
      direction: "naik",
      measured_at: "2026-09-01 00:00:00",
    },
    {
      id: "21",
      objective_id: "10",
      title: "Hari proses surat",
      baseline: "10.00",
      target: "2.00",
      current_value: "6.00",
      direction: "turun",
      sort: "2",
    },
    { id: "22", objective_id: "999", title: "x", target: "1.00", direction: "naik" },
    { id: "23", objective_id: "11", title: "y", target: "1.00", direction: "?" },
  ]),
  programs: table([
    {
      ...p,
      id: "30",
      org_unit_id: "41",
      key_result_id: "20",
      name: "Webinar",
      pic_user_id: "1",
      background: "Latar",
      goal: "Tujuan",
      target_audience: "Mahasiswa",
      location: "Daring",
      risks: JSON.stringify([{ risiko: "Sepi", mitigasi: "Promosi" }]),
      planned_start: "2026-08-15",
      planned_end: "2026-09-05",
      budget_estimate: "50000.00",
      budget_currency: "JPY",
      status: "selesai",
      progress_percent: "70",
      approved_by_user_id: "4",
      approved_at: "2026-08-12 00:00:00",
      started_at: "2026-08-15 00:00:00",
      completed_at: "2026-09-06 10:00:00",
      lpj_deadline: "2026-09-20",
    },
    {
      ...p,
      id: "31",
      name: "Pelatihan",
      budget_estimate: "1500000.50",
      budget_currency: "IDR",
      status: "berjalan",
      progress_percent: "0",
      health: "at_risk",
      health_reason: "Visa",
      health_updated_at: "2026-10-01 00:00:00",
      risks: "{bad",
    },
    { ...p, id: "32", key_result_id: "22", name: "Usulan", status: "usulan", review_note: "Isi" },
    { ...p, id: "33", name: "Batal", status: "dibatalkan", cancel_reason: "Dana" },
    { ...p, id: "34", name: "Arsip", status: "arsip" },
    { ...p, id: "35", org_unit_id: "99", name: "Unit hilang", status: "berjalan" },
    {
      ...p,
      id: "36",
      name: "Lomba",
      budget_estimate: "12.50",
      budget_currency: "JPY",
      status: "selesai",
    },
    {
      ...p,
      id: "37",
      name: "Rupiah",
      budget_estimate: "5.00",
      budget_currency: "Rp",
      status: "usulan",
      health: "on_track",
    },
  ]),
  program_members: table([
    { id: "1", program_id: "30", user_id: "2", role_label: "Bendahara" },
    { id: "2", program_id: "30", user_id: "1" },
    { id: "3", program_id: "31", user_id: "3" },
    { id: "4", program_id: "999", user_id: "1" },
  ]),
  program_milestones: table([
    {
      id: "301",
      program_id: "30",
      title: "Acara",
      due_date: "2026-09-05",
      weight: "1",
      sort: "1",
    },
    {
      id: "300",
      program_id: "30",
      title: "Panitia",
      weight: "3",
      sort: "0",
      completed_at: "2026-08-20 00:00:00",
      completed_by_user_id: "2",
    },
    { id: "302", program_id: "31", title: "Materi", weight: "0", sort: "0" },
    { id: "303", program_id: "999", title: "x", weight: "1", sort: "0" },
  ]),
  program_checkins: table([
    {
      id: "500",
      program_id: "31",
      user_id: "3",
      week_start: "2026-10-05",
      achievements: "Materi dibuat",
      created_at: "2026-10-06 00:00:00",
    },
    { id: "501", program_id: "31", week_start: "2026-10-07", achievements: "Lagi" },
    { id: "502", program_id: "999", week_start: "2026-10-05", achievements: "x" },
    {
      id: "503",
      program_id: "31",
      week_start: "2026-10-12",
      achievements: "Uji coba",
      blockers: "Jadwal",
      next_plan: "Rekam",
    },
  ]),
  program_reports: table([
    {
      id: "600",
      program_id: "30",
      period_id: "3",
      status: "disetujui",
      realization: "Terlaksana",
      realized_amount: "45000.00",
      realized_currency: "JPY",
      participant_count: "30",
      documentation_links: JSON.stringify([{ label: "Foto", url: "https://example.org/foto" }]),
      testimonials: "Bagus",
      obstacles: "Zona waktu",
      recommendations: "Rekam",
      submitted_by_user_id: "1",
      submitted_at: "2026-09-10 00:00:00",
      secretary_reviewed_by_user_id: "2",
      secretary_reviewed_at: "2026-09-11 00:00:00",
      treasurer_reviewed_by_user_id: "3",
      treasurer_reviewed_at: "2026-09-12 00:00:00",
      approved_by_user_id: "4",
      approved_at: "2026-09-13 00:00:00",
      created_at: "2026-09-06 10:00:00",
    },
    {
      id: "601",
      program_id: "36",
      period_id: "3",
      status: "diajukan",
      submitted_by_user_id: "1",
      submitted_at: "2026-10-01 00:00:00",
      secretary_reviewed_by_user_id: "2",
      secretary_reviewed_at: "2026-10-02 00:00:00",
      revision_note: "Lama",
      revision_round: "1",
    },
    { id: "602", program_id: "31", period_id: "3", status: "draft" },
    { id: "603", program_id: "999", period_id: "3", status: "draft" },
    { id: "604", program_id: "33", period_id: "3", status: "?" },
  ]),
  keuangan_pengajuan: table([
    {
      ...f,
      id: "700",
      kategori: "pencairan",
      status: "dicairkan",
      nama_kegiatan: "Sewa Zoom",
      deskripsi: "Satu bulan",
      nominal: "200000.00",
      tanggal: "2026-09-01",
      rekening_tujuan: "BNI - 123 - Ana",
      sumber_dana: "Kas",
      program_id: "30",
      dokumen: JSON.stringify(["keuangan/700/rab.pdf"]),
      treasurer_reviewed_by_user_id: "2",
      treasurer_reviewed_at: "2026-09-02 00:00:00",
      catatan_review: "Angka cocok",
      coordinator_approved_by_user_id: "3",
      coordinator_approved_at: "2026-09-02 05:00:00",
      disbursed_by_user_id: "2",
      disbursed_at: "2026-09-03 05:00:00",
      disbursed_amount: "150000.00",
      bukti_transfer: JSON.stringify(["keuangan/700/tf.pdf", "keuangan/700/tf2.pdf"]),
      created_at: "2026-09-01 00:00:00",
    },
    {
      ...f,
      id: "701",
      kategori: "anggaran",
      status: "selesai",
      nama_kegiatan: "RAB Lomba",
      dokumen: JSON.stringify(["keuangan/701/rab.pdf"]),
      disbursed_at: "2026-09-04 00:00:00",
      updated_at: "2026-09-05 00:00:00",
    },
    {
      ...f,
      id: "702",
      kategori: "reimburse",
      status: "ditolak",
      nama_kegiatan: "Taksi",
      dokumen: "{bad",
      treasurer_reviewed_by_user_id: "2",
      treasurer_reviewed_at: "2026-09-02 00:00:00",
      catatan_koordinator: "Tidak sesuai",
      updated_at: "2026-09-03 00:00:00",
    },
    {
      ...f,
      id: "703",
      kategori: "pencairan",
      status: "revisi",
      nama_kegiatan: "Konsumsi",
      program_id: "999",
      revision_note: "Lengkapi",
      revision_round: "1",
    },
    { ...f, id: "704", kategori: "pencairan", status: "?", nama_kegiatan: "x" },
    {
      ...f,
      id: "705",
      kategori: "penerimaan",
      status: "draft",
      nama_kegiatan: "Sponsor",
      created_by_user_id: "",
      dokumen: JSON.stringify(["keuangan/705/foto.jpg"]),
    },
    {
      ...f,
      id: "706",
      kategori: "pencairan",
      status: "draft",
      nama_kegiatan: "x",
      nominal: "-5.00",
    },
    { ...f, id: "707", kategori: "hibah", status: "draft", nama_kegiatan: "x" },
    {
      ...f,
      id: "708",
      org_unit_id: "99",
      kategori: "pencairan",
      status: "draft",
      nama_kegiatan: "x",
    },
  ]),
  keuangan_transaksi: table([
    {
      id: "800",
      period_id: "3",
      tanggal: "2026-09-03",
      jenis: "keluar",
      kategori: "pencairan",
      uraian: "Sewa Zoom",
      nominal: "150000.00",
      sumber: "pengajuan",
      pengajuan_id: "700",
    },
    {
      id: "801",
      period_id: "3",
      tanggal: "2026-08-01",
      jenis: "masuk",
      kategori: "saldo_awal",
      uraian: "Saldo awal",
      nominal: "1000000.00",
      bukti: JSON.stringify(["kas/801.pdf"]),
      created_by_user_id: "1",
      created_at: "2026-08-01 00:00:00",
    },
    {
      id: "802",
      period_id: "3",
      org_unit_id: "40",
      tanggal: "2026-09-10",
      jenis: "keluar",
      kategori: "lain",
      uraian: "Materai",
      nominal: "50000.00",
    },
    {
      id: "803",
      period_id: "3",
      tanggal: "2026-09-10",
      jenis: "keluar",
      kategori: "pencairan",
      uraian: "x",
      nominal: "1.00",
      pengajuan_id: "999",
    },
    {
      id: "804",
      period_id: "3",
      tanggal: "2026-09-10",
      jenis: "masuk",
      kategori: "?",
      uraian: "x",
      nominal: "1.00",
    },
    {
      id: "805",
      period_id: "3",
      tanggal: "2026-09-10",
      jenis: "masuk",
      kategori: "iuran",
      uraian: "x",
      nominal: "1.234",
    },
  ]),
};

const files: Record<string, { size: number; sha256: string }> = {
  "keuangan/700/rab.pdf": { size: 2048, sha256: "a".repeat(64) },
  "keuangan/700/tf.pdf": { size: 1024, sha256: "b".repeat(64) },
  "keuangan/700/tf2.pdf": { size: 1024, sha256: "c".repeat(64) },
  "kas/801.pdf": { size: 512, sha256: "d".repeat(64) },
};
const plan = mapPpidkPrograms(tables, {
  uidOf: (id) => (id === "1" ? "firebase-ana" : `ppidk-${id}`),
  file: (path) => files[path] ?? null,
  now,
});
const doc = (path: string) => plan.writes.find((w) => w.path === path)?.data;
const reasons = plan.skipped.map((s) => `${s.table}/${s.id}: ${s.reason}`);

const stores = () => {
  const fake = fakeDb();
  for (const w of plan.writes) fake.docs.set(w.path, w.data);
  const db = fake.db as unknown as Parameters<typeof createSqlProgramStore>[0];
  return {
    objectives: createSqlObjectiveStore(db),
    programs: createSqlProgramStore(db),
    lpj: createSqlLpjStore(db),
    finance: createSqlFinanceStore(db),
    report: createSqlPeriodReport(db),
  };
};
const period = "ppidk-period-3";

describe("PPIDK programmes and finance import (step 6.7)", () => {
  it("imported OKR and programmes read correctly through the platform stores", async () => {
    const s = stores();
    const okr = await s.objectives.listForPeriod(period);
    expect(okr.map((o) => [o.id, o.orgUnitPath, objectivePercent(o)])).toEqual([
      ["ppidk-objective-11", [], 0],
      ["ppidk-objective-10", ["ppidk-unit-40", "ppidk-unit-41"], 50],
    ]);
    expect(okr[1]?.keyResults[0]).toEqual({
      id: "ppidk-keyresult-20",
      title: "Peserta",
      unit: "orang",
      baseline: 0,
      target: 100,
      current: 50,
      direction: "up",
      sort: 0,
      measuredAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(okr[1]?.keyResults[1]).toMatchObject({ direction: "down", unit: "", measuredAt: null });

    const webinar = await s.programs.get("ppidk-program-30");
    expect(webinar).toMatchObject({
      status: "finished",
      orgUnitPath: ["ppidk-unit-40", "ppidk-unit-41"],
      objectiveId: "ppidk-objective-10",
      keyResultId: "ppidk-keyresult-20",
      pics: ["firebase-ana", "ppidk-2"],
      budgets: [{ amountMinor: 50000, currency: "JPY" }],
      progressPercent: 75,
      goal: "Tujuan",
      plannedStart: "2026-08-15",
      approvedBy: "ppidk-4",
      finishedAt: new Date("2026-09-06T10:00:00Z"),
      createdBy: "ppidk",
      version: 1,
      deletedAt: null,
    });
    expect(webinar?.description).toBe(
      "Latar\n\nTarget audience: Mahasiswa\nLocation: Daring\nRisk: Sepi (mitigation: Promosi)",
    );
    expect(webinar?.milestones.map((m) => [m.id, m.weight, m.completedBy])).toEqual([
      ["ppidk-milestone-300", 3, "ppidk-2"],
      ["ppidk-milestone-301", 1, null],
    ]);
    expect(await s.programs.get("ppidk-program-31")).toMatchObject({
      status: "running",
      pics: ["ppidk-3"],
      budgets: [{ amountMinor: 150000050, currency: "IDR" }],
      health: { status: "at_risk", reason: "Visa", by: "ppidk" },
      progressPercent: 0,
      description: "",
    });
    expect(await s.programs.get("ppidk-program-32")).toMatchObject({
      status: "proposed",
      budgets: [],
      objectiveId: null,
      keyResultId: null,
      reviewNote: "Isi",
      health: null,
    });
    expect(await s.programs.get("ppidk-program-33")).toMatchObject({
      status: "cancelled",
      cancelReason: "Dana",
    });
    expect(await s.programs.get("ppidk-program-34")).toBeNull();
    expect(await s.programs.listCheckins("ppidk-program-31")).toEqual([
      expect.objectContaining({
        id: "ppidk-program-31_2026-10-12",
        userId: "ppidk",
        blockers: "Jadwal",
        nextPlan: "Rekam",
        createdAt: now,
      }),
      expect.objectContaining({
        id: "ppidk-program-31_2026-10-05",
        weekStart: "2026-10-05",
        userId: "ppidk-3",
        achievements: "Materi dibuat",
        blockers: "",
        nextPlan: "",
        createdAt: new Date("2026-10-06T00:00:00Z"),
      }),
    ]);
  });

  it("imported LPJs keep their status, desks and due date", async () => {
    const s = stores();
    expect(await s.lpj.get("ppidk-program-30")).toMatchObject({
      programId: "ppidk-program-30",
      status: "approved",
      dueOn: "2026-09-20",
      pics: ["firebase-ana", "ppidk-2"],
      realized: [{ amountMinor: 45000, currency: "JPY" }],
      participantCount: 30,
      realization:
        "Terlaksana\n\nTestimonials:\nBagus\n\nDocumentation:\n- Foto: https://example.org/foto",
      submittedBy: "firebase-ana",
      secretariat: { uid: "ppidk-2", at: new Date("2026-09-11T00:00:00Z") },
      treasurer: { uid: "ppidk-3", at: new Date("2026-09-12T00:00:00Z") },
      approval: { uid: "ppidk-4", at: new Date("2026-09-13T00:00:00Z") },
      plan: {
        name: "Webinar",
        unitName: "Biro Kesekretariatan",
        budgets: [{ amountMinor: 50000, currency: "JPY" }],
        progressPercent: 75,
        milestones: [
          { title: "Panitia", dueOn: null, weight: 3, done: true },
          { title: "Acara", dueOn: "2026-09-05", weight: 1, done: false },
        ],
        finishedAt: new Date("2026-09-06T10:00:00Z"),
      },
    });
    expect(await s.lpj.get("ppidk-program-36")).toMatchObject({
      status: "submitted",
      dueOn: "2026-11-18",
      realized: null,
      realization: "",
      returnNote: "Lama",
      revisionRound: 1,
      secretariat: { uid: "ppidk-2" },
      treasurer: null,
      approval: null,
    });
    expect(await s.lpj.get("ppidk-program-31")).toBeNull();
  });

  it("the period report card adds the imported budgets per currency", async () => {
    const card = await stores().report.card(period, now);
    expect(card.programmes).toMatchObject({
      counts: { proposed: 2, approved: 0, running: 1, finished: 2, cancelled: 1 },
      troubled: 1,
      completionPercent: 67,
    });
    expect(card.budget).toEqual([
      {
        currency: "IDR",
        planned: { amountMinor: 150000050, currency: "IDR" },
        realized: { amountMinor: 0, currency: "IDR" },
        absorptionPercent: 0,
      },
      {
        currency: "JPY",
        planned: { amountMinor: 50000, currency: "JPY" },
        realized: { amountMinor: 45000, currency: "JPY" },
        absorptionPercent: 90,
      },
    ]);
    expect(card.lpj).toEqual({ submitted: 1, approved: 1, overdue: 0 });
    expect(card.okr.achievementPercent).toBe(25);
  });

  it("imported finance requests and the cash book read correctly", async () => {
    const s = stores();
    expect(await s.finance.get("ppidk-finance-700")).toMatchObject({
      category: "disbursement",
      status: "paid",
      orgUnitPath: ["ppidk-unit-40", "ppidk-unit-41"],
      amountMinor: 20000000,
      currency: "IDR",
      date: "2026-09-01",
      account: "BNI - 123 - Ana",
      fundSource: "Kas",
      programId: "ppidk-program-30",
      createdBy: "firebase-ana",
      documents: [
        {
          path: "finance/ppidk-period-3/ppidk-finance-700_doc_ppidk000.pdf",
          name: "rab.pdf",
          size: 2048,
          sha256: "a".repeat(64),
        },
      ],
      treasurer: { uid: "ppidk-2", at: new Date("2026-09-02T00:00:00Z"), note: "Angka cocok" },
      coordinator: { uid: "ppidk-3", note: null },
      payment: {
        uid: "ppidk-2",
        at: new Date("2026-09-03T05:00:00Z"),
        amountMinor: 15000000,
        proof: {
          path: "finance/ppidk-period-3/ppidk-finance-700_proof_ppidkpdf.pdf",
          name: "tf.pdf",
          size: 1024,
        },
      },
      revisionRound: 0,
      rejection: null,
    });
    expect(await s.finance.get("ppidk-finance-701")).toMatchObject({
      category: "budget",
      status: "done",
      documents: [],
      doneAt: new Date("2026-09-05T00:00:00Z"),
      payment: { uid: "ppidk", amountMinor: 10000000, proof: { path: "", size: 0, sha256: "" } },
    });
    expect(await s.finance.get("ppidk-finance-702")).toMatchObject({
      status: "rejected",
      documents: [],
      rejection: { uid: "ppidk", at: new Date("2026-09-03T00:00:00Z"), note: "Tidak sesuai" },
      coordinator: null,
    });
    expect(await s.finance.get("ppidk-finance-703")).toMatchObject({
      status: "revision",
      programId: null,
      revisionNote: "Lengkapi",
      revisionRound: 1,
    });
    expect(await s.finance.get("ppidk-finance-705")).toMatchObject({
      category: "receipt",
      createdBy: "ppidk",
      documents: [],
    });
    const list = await s.finance.list({
      periodId: period,
      orgUnitIds: ["ppidk-unit-41"],
      limit: 20,
    });
    expect(list.map((r) => r.id).sort()).toEqual([
      "ppidk-finance-700",
      "ppidk-finance-701",
      "ppidk-finance-702",
      "ppidk-finance-703",
      "ppidk-finance-705",
    ]);

    const entries = await s.finance.listEntries(period);
    expect(entries.find((e) => e.id === "ppidk-finance-700")).toMatchObject({
      source: "request",
      requestId: "ppidk-finance-700",
      kind: "out",
      category: "disbursement",
      date: "2026-09-03",
      amountMinor: 15000000,
    });
    expect(entries.find((e) => e.id === "ppidk-cash-801")).toMatchObject({
      source: "manual",
      kind: "in",
      category: "opening_balance",
      orgUnitId: null,
      createdBy: "firebase-ana",
      proof: { path: "finance/ppidk-period-3/ppidk-cash-801_proof_ppidkpdf.pdf", size: 512 },
    });
    expect(entries.find((e) => e.id === "ppidk-cash-802")).toMatchObject({
      category: "other_out",
      orgUnitId: "ppidk-unit-40",
      proof: null,
      createdBy: "ppidk",
    });
    expect(cashReport(entries, { from: null, to: null })).toEqual([
      expect.objectContaining({
        currency: "IDR",
        totalIn: 100000000,
        totalOut: 20000000,
        closing: 80000000,
      }),
    ]);
  });

  it("reports every row it cannot map and copies only the PDFs found", () => {
    expect(plan.files).toEqual([
      {
        from: "keuangan/700/rab.pdf",
        to: "finance/ppidk-period-3/ppidk-finance-700_doc_ppidk000.pdf",
        contentType: "application/pdf",
      },
      {
        from: "keuangan/700/tf.pdf",
        to: "finance/ppidk-period-3/ppidk-finance-700_proof_ppidkpdf.pdf",
        contentType: "application/pdf",
      },
      {
        from: "kas/801.pdf",
        to: "finance/ppidk-period-3/ppidk-cash-801_proof_ppidkpdf.pdf",
        contentType: "application/pdf",
      },
    ]);
    expect(reasons.sort()).toEqual(
      [
        "objectives/12: unit not imported",
        "key_results/22: objective not imported",
        "key_results/23: direction ?",
        "programs/30: progress recomputed from the milestones: 70 → 75",
        "programs/32: key result not imported",
        "programs/34: status arsip",
        "programs/35: unit not imported",
        "programs/36: budget not imported: 12.50 JPY",
        "programs/37: budget not imported: 5.00 Rp",
        "program_members/4: programme not imported",
        "program_milestones/302: weight 0 changed to 1",
        "program_milestones/303: programme not imported",
        "program_checkins/501: week 2026-10-05 already has a check-in",
        "program_checkins/502: programme not imported",
        "program_reports/602: programme not imported or not finished",
        "program_reports/603: programme not imported or not finished",
        "program_reports/604: status ?",
        "keuangan_pengajuan/700: proof of transfer not imported (one per request): keuangan/700/tf2.pdf",
        "keuangan_pengajuan/701: file not found: keuangan/701/rab.pdf",
        "keuangan_pengajuan/703: programme not imported, not linked",
        "keuangan_pengajuan/704: status ?",
        "keuangan_pengajuan/705: file not imported (only PDFs): keuangan/705/foto.jpg",
        "keuangan_pengajuan/706: amount not imported: -5.00 IDR",
        "keuangan_pengajuan/707: category hibah",
        "keuangan_pengajuan/708: unit not imported",
        "keuangan_transaksi/803: request not imported",
        "keuangan_transaksi/804: category ?",
        "keuangan_transaksi/805: amount not imported: 1.234 IDR",
      ].sort(),
    );
    expect(doc("cashEntries/ppidk-cash-800")).toBeUndefined();
    expect(doc("cashEntries/ppidk-finance-701")).toBeUndefined();
    expect(plan.counts).toMatchObject({
      objectives: 2,
      programs: 6,
      programCheckins: 2,
      lpjReports: 2,
      financeRequests: 5,
      cashEntries: 3,
      files: 3,
    });
  });
});
