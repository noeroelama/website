import { describe, expect, it } from "vitest";
import { parseAnswers, type Question } from "@website/domain/forms";
import { parseTsv } from "../../packages/db/src/ppidk/people";
import {
  mapPpidkRecruitment,
  type PpidkRecruitmentTables,
} from "../../packages/db/src/ppidk/recruitment";

const tsv = (header: string[], rows: string[][]) =>
  parseTsv([header.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n") + "\n");
const now = new Date("2026-10-24T00:00:00Z");

const schema = (fields: object[]) => JSON.stringify({ fields });
const oprecFields = [
  { key: "motivasi", label: "Motivasi", type: "textarea", required: true },
  { key: "cv_terbaru", label: "CV", type: "file", required: false },
  { key: "ipk", label: "IPK", type: "number", required: false },
  { key: "bidang_minat", label: "Bidang minat", type: "multiselect", options: ["Desain", "Video"] },
  { key: "tautan", label: "Portofolio daring", type: "url" },
  { key: "satu_opsi", label: "Satu opsi", type: "select", options: ["Ya"] },
];

const tables: PpidkRecruitmentTables = {
  users: tsv(
    ["id", "email"],
    [
      ["1", "ana@example.org"],
      ["2", "rio@example.org"],
      ["9", "NULL"],
    ],
  ),
  org_units: tsv(
    ["id", "period_id", "name", "active_for_selection", "requires_portfolio", "quota"],
    [
      ["50", "3", "Direktorat Media", "1", "1", "2"],
      ["51", "3", "Keuangan", "1", "0", "NULL"],
      ["52", "3", "Koordinator", "0", "0", "NULL"],
    ],
  ),
  forms: tsv(
    [
      "id",
      "title",
      "description",
      "type",
      "status",
      "opens_at",
      "closes_at",
      "respondent_mode",
      "public_token",
      "created_at",
    ],
    [
      [
        "10",
        "Oprec 2026",
        "Gabung!",
        "recruitment",
        "open",
        "2026-08-01 00:00:00",
        "2026-08-20 00:00:00",
        "member",
        "NULL",
        "2026-07-30 00:00:00",
      ],
      [
        "11",
        "Survei Kongres",
        "NULL",
        "general",
        "closed",
        "NULL",
        "NULL",
        "guest",
        "abcdefghijklmnopqrstuvwxyz012345",
        "2026-07-01 00:00:00",
      ],
      [
        "12",
        "Kotak Aspirasi",
        "NULL",
        "general",
        "open",
        "NULL",
        "NULL",
        "member",
        "zyxwvutsrqponmlkjihgfedcba543210",
        "2026-07-01 00:00:00",
      ],
      [
        "13",
        "Tanpa versi",
        "NULL",
        "general",
        "draft",
        "NULL",
        "NULL",
        "anonymous",
        "NULL",
        "2026-07-01 00:00:00",
      ],
    ],
  ),
  form_versions: tsv(
    ["id", "form_id", "version", "schema", "created_at"],
    [
      ["100", "10", "1", schema(oprecFields), "2026-07-30 00:00:00"],
      [
        "101",
        "11",
        "1",
        schema([{ key: "kesan", label: "Kesan", type: "text", required: true }]),
        "2026-07-01 00:00:00",
      ],
      [
        "102",
        "11",
        "2",
        schema([
          { key: "kesan", label: "Kesan Anda", type: "text", required: true },
          { key: "nilai", label: "Nilai", type: "select", options: ["Baik", "Buruk"] },
        ]),
        "2026-07-02 00:00:00",
      ],
      ["103", "12", "1", "not json", "2026-07-01 00:00:00"],
    ],
  ),
  form_responses: tsv(
    [
      "id",
      "form_id",
      "form_version_id",
      "respondent_name",
      "respondent_email",
      "data",
      "submitted_at",
    ],
    [
      [
        "200",
        "11",
        "101",
        "Budi",
        "budi@example.org",
        JSON.stringify({ kesan: "Seru", hilang: "x" }),
        "2026-07-05 10:00:00",
      ],
      [
        "201",
        "11",
        "102",
        "NULL",
        "NULL",
        JSON.stringify({ kesan: 5, nilai: "Baik" }),
        "2026-07-06 10:00:00",
      ],
    ],
  ),
  recruitments: tsv(
    ["id", "form_id", "period_id", "choice_count", "pakta_template_path", "created_at"],
    [
      ["20", "10", "3", "2", "pakta/template.docx", "2026-07-30 00:00:00"],
      ["21", "99", "3", "2", "NULL", "2026-07-30 00:00:00"],
    ],
  ),
  recruitment_applications: tsv(
    [
      "id",
      "recruitment_id",
      "form_version_id",
      "user_id",
      "data",
      "status",
      "submitted_at",
      "offered_org_unit_id",
      "offered_at",
      "offer_deadline",
      "pakta_path",
      "pakta_rejection_note",
      "created_at",
    ],
    [
      [
        "300",
        "20",
        "100",
        "1",
        JSON.stringify({ motivasi: "Lama" }),
        "withdrawn",
        "2026-08-02 00:00:00",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "2026-08-01 00:00:00",
      ],
      [
        "301",
        "20",
        "100",
        "1",
        JSON.stringify({
          motivasi: "Ingin berkontribusi",
          cv_terbaru: "lamaran/cv-ana.pdf",
          ipk: "3.8",
          bidang_minat: ["Desain"],
          tautan: "https://ana.example",
        }),
        "pakta_review",
        "2026-08-03 00:00:00",
        "50",
        "2026-08-10 00:00:00",
        "2026-08-13 00:00:00",
        "pakta/ana.pdf",
        "Tanda tangan kurang",
        "2026-08-02 00:00:00",
      ],
      [
        "302",
        "20",
        "100",
        "2",
        JSON.stringify({
          motivasi: "Hai",
          cv_terbaru: "lamaran/cv-rio.docx",
          bidang_minat: "Video",
        }),
        "interview",
        "2026-08-04 00:00:00",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "2026-08-03 00:00:00",
      ],
      [
        "303",
        "20",
        "100",
        "9",
        "{}",
        "submitted",
        "2026-08-04 00:00:00",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "2026-08-03 00:00:00",
      ],
      [
        "304",
        "21",
        "100",
        "2",
        "{}",
        "submitted",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "2026-08-03 00:00:00",
      ],
    ],
  ),
  application_choices: tsv(
    ["id", "application_id", "org_unit_id", "rank", "portfolio_path"],
    [
      ["400", "301", "51", "2", "NULL"],
      ["401", "301", "50", "1", "portofolio/ana.pdf"],
      ["402", "302", "51", "1", "NULL"],
    ],
  ),
  application_revisions: tsv(
    [
      "id",
      "application_id",
      "requested_by_user_id",
      "fields",
      "note",
      "resubmitted_at",
      "created_at",
    ],
    [
      [
        "500",
        "301",
        "2",
        JSON.stringify([{ key: "motivasi", note: "Lebih rinci" }]),
        "Perbaiki",
        "2026-08-06 00:00:00",
        "2026-08-05 00:00:00",
      ],
      ["501", "301", "NULL", "NULL", "NULL", "NULL", "2026-08-07 00:00:00"],
    ],
  ),
  interview_slots: tsv(
    ["id", "recruitment_id", "starts_at", "ends_at", "capacity", "location", "is_open"],
    [
      [
        "600",
        "20",
        "2026-08-08 02:00:00",
        "2026-08-08 02:30:00",
        "2",
        "https://meet.example/a",
        "1",
      ],
      ["601", "20", "2026-08-08 03:00:00", "2026-08-08 03:30:00", "1", "NULL", "0"],
      ["602", "21", "2026-08-08 03:00:00", "2026-08-08 03:30:00", "1", "NULL", "1"],
    ],
  ),
  interviews: tsv(
    ["id", "application_id", "interview_slot_id", "status"],
    [
      ["700", "302", "600", "booked"],
      ["701", "301", "601", "cancelled"],
    ],
  ),
  personality_results: tsv(
    ["id", "user_id", "code", "identity", "full", "axes", "taken_at"],
    [
      [
        "800",
        "1",
        "ENFJ",
        "A",
        "ENFJ-A",
        JSON.stringify({ mind: { letter: "E", pct: 80, lean: 0.6, label: "Pikiran" }, energy: {} }),
        "2026-08-04 00:00:00",
      ],
      ["801", "77", "ISTP", "T", "ISTP-T", "{}", "2026-08-04 00:00:00"],
    ],
  ),
};

const sizes: Record<string, number> = {
  "lamaran/cv-ana.pdf": 2048,
  "portofolio/ana.pdf": 4096,
  "pakta/ana.pdf": 1024,
};
const plan = mapPpidkRecruitment(tables, {
  uidOf: (id) => (id === "1" ? "firebase-ana" : `ppidk-${id}`),
  fileSize: (path) => sizes[path] ?? null,
  now,
});
const doc = (path: string) => plan.writes.find((w) => w.path === path)?.data;
const reasons = () => plan.skipped.map((s) => `${s.table}/${s.id}: ${s.reason}`);

describe("PPIDK forms import (step 5.8)", () => {
  it("maps forms, versions (frozen when answered) and question types", () => {
    expect(doc("forms/ppidk-form-11")).toMatchObject({
      title: "Survei Kongres",
      usage: "public",
      status: "closed",
      publicToken: "abcdefghijklmnopqrstuvwxyz012345",
      currentVersion: 2,
      responseCount: 2,
    });
    expect(doc("forms/ppidk-form-10")).toMatchObject({
      usage: "recruitment",
      status: "draft",
      publicToken: null,
    });
    expect(doc("forms/ppidk-form-13")).toBeUndefined();
    expect(doc("formVersions/ppidk-form-11_1")).toMatchObject({ answered: true });
    const oprec = doc("formVersions/ppidk-form-10_1") as {
      questions: Question[];
      answered: boolean;
    };
    expect(oprec.answered).toBe(true);
    expect(oprec.questions.map((q) => [q.id, q.type])).toEqual([
      ["q_motivasi", "long_text"],
      ["q_cvterbaru", "file"],
      ["q_ipk", "number"],
      ["q_bidangminat", "multi_choice"],
      ["q_tautan", "short_text"],
      ["q_satuopsi", "short_text"],
    ]);
    const v2 = doc("formVersions/ppidk-form-11_2") as { questions: Question[] };
    expect(v2.questions.map((q) => q.id)).toEqual([
      "q_kesan",
      "q_nilai",
      "q_respondentname",
      "q_respondentemail",
    ]);
    expect(parseAnswers(v2.questions, { q_kesan: "ok", q_nilai: "Baik" })).toMatchObject({
      ok: true,
    });
    expect(reasons()).toEqual(
      expect.arrayContaining([
        'form_versions/100: "Satu opsi" has fewer than 2 options: imported as a short answer',
        "forms/12: members-only form imported as a public (guest) form",
        "forms/13: no version: not imported",
      ]),
    );
  });

  it("maps responses by question id; unknown keys are dropped, guests keep their identity", () => {
    expect(doc("formResponses/ppidk-response-200")).toEqual({
      formId: "ppidk-form-11",
      version: 1,
      answers: { q_kesan: "Seru", q_respondentname: "Budi", q_respondentemail: "budi@example.org" },
      submittedAt: new Date("2026-07-05T10:00:00Z"),
    });
    expect(doc("formResponses/ppidk-response-201")).toMatchObject({
      version: 2,
      answers: { q_kesan: "5", q_nilai: "Baik" },
    });
  });
});

describe("PPIDK recruitment import (step 5.8)", () => {
  it("maps the recruitment with its units, quotas and seats taken", () => {
    expect(doc("recruitments/ppidk-recruitment-20")).toMatchObject({
      periodId: "ppidk-period-3",
      title: "Oprec 2026",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: "2026-08-20T00:00:00.000Z",
      maxChoices: 2,
      formId: "ppidk-form-10",
      formVersion: 1,
      published: true,
      units: [
        { orgUnitId: "ppidk-unit-50", name: "Direktorat Media", quota: 2, portfolioRequired: true },
        { orgUnitId: "ppidk-unit-51", name: "Keuangan", quota: 500, portfolioRequired: false },
      ],
    });
    expect(doc("seatCounters/ppidk-recruitment-20_ppidk-unit-50")).toMatchObject({
      quota: 2,
      filled: 1,
    });
    expect(doc("seatCounters/ppidk-recruitment-20_ppidk-unit-51")).toMatchObject({ filled: 0 });
    expect(doc("recruitments/ppidk-recruitment-21")).toBeUndefined();
    expect(reasons()).toEqual(
      expect.arrayContaining([
        "recruitments/21: no form: not imported",
        "recruitments/20: pact template is a file (pakta/template.docx): set its link on the Recruitment page",
      ]),
    );
  });

  it("maps applications: latest per person, ordered choices, files, offer, rounds, booking", () => {
    const ana = doc("applications/ppidk-recruitment-20_firebase-ana");
    expect(ana).toMatchObject({
      userId: "firebase-ana",
      status: "pakta_review",
      choices: ["ppidk-unit-50", "ppidk-unit-51"],
      answers: {
        q_motivasi: "Ingin berkontribusi",
        q_cvterbaru: {
          path: "forms/ppidk-form-10/firebase-ana_ppidk_301_1.pdf",
          name: "cv_terbaru.pdf",
          contentType: "application/pdf",
          size: 2048,
        },
        q_ipk: 3.8,
        q_bidangminat: ["Desain"],
        q_tautan: "https://ana.example",
      },
      portfolio: {
        path: "recruitment/ppidk-recruitment-20/firebase-ana/portfolio_ppidk_401.pdf",
        size: 4096,
      },
      revisionRound: 2,
      offer: { orgUnitId: "ppidk-unit-50", expiresAt: new Date("2026-08-13T00:00:00Z") },
      interview: null,
      pacts: [
        { path: "recruitment/ppidk-recruitment-20/firebase-ana/pact_ppidk_301.pdf", size: 1024 },
      ],
      pactNote: "Tanda tangan kurang",
    });
    expect(doc("applicationRevisions/ppidk-recruitment-20_firebase-ana_1")).toMatchObject({
      round: 1,
      request: "Perbaiki\n- motivasi: Lebih rinci",
      requestedBy: "ppidk-2",
      resubmittedAt: new Date("2026-08-06T00:00:00Z"),
    });
    expect(doc("applicationRevisions/ppidk-recruitment-20_firebase-ana_2")).toMatchObject({
      request: "(no note)",
      requestedBy: "ppidk",
      resubmittedAt: null,
    });
    const rio = doc("applications/ppidk-recruitment-20_ppidk-2");
    expect(rio).toMatchObject({
      status: "interview",
      answers: { q_motivasi: "Hai", q_bidangminat: ["Video"] },
      portfolio: null,
      interview: { slotId: "ppidk-slot-600", startsAt: new Date("2026-08-08T02:00:00Z") },
    });
    expect(plan.files.map((f) => f.from).sort()).toEqual([
      "lamaran/cv-ana.pdf",
      "pakta/ana.pdf",
      "portofolio/ana.pdf",
    ]);
    expect(reasons()).toEqual(
      expect.arrayContaining([
        "recruitment_applications/300: an older application of the same person: only the latest is kept",
        "recruitment_applications/302: file not imported (only PDFs): lamaran/cv-rio.docx",
        "recruitment_applications/303: unknown user",
        "recruitment_applications/304: recruitment not imported",
      ]),
    );
  });

  it("maps interview slots and personality results", () => {
    expect(doc("interviewSlots/ppidk-slot-600")).toMatchObject({
      recruitmentId: "ppidk-recruitment-20",
      durationMinutes: 30,
      capacity: 2,
      booked: 1,
      location: "https://meet.example/a",
      deletedAt: null,
    });
    expect(doc("interviewSlots/ppidk-slot-601")).toMatchObject({ booked: 0, deletedAt: now });
    expect(doc("interviewSlots/ppidk-slot-602")).toBeUndefined();
    expect(doc("personalityResults/firebase-ana")).toEqual({
      code: "ENFJ",
      identity: "A",
      full: "ENFJ-A",
      axes: { mind: { letter: "E", pct: 80, lean: 0.6 }, energy: { letter: "", pct: 50, lean: 0 } },
      completedAt: new Date("2026-08-04T00:00:00Z"),
    });
    expect(reasons()).toContain("personality_results/801: unknown user");
    expect(plan.counts).toMatchObject({
      applications: 2,
      interviewSlots: 2,
      files: 3,
      personalityResults: 1,
    });
  });

  it("references no file it cannot copy", () => {
    const withoutFiles = mapPpidkRecruitment(tables, {
      uidOf: (id) => `ppidk-${id}`,
      fileSize: () => null,
      now,
    });
    expect(withoutFiles.files).toEqual([]);
    expect(
      withoutFiles.writes.find((w) => w.path === "applications/ppidk-recruitment-20_ppidk-1")?.data,
    ).toMatchObject({ portfolio: null, pacts: [] });
    expect(withoutFiles.skipped.map((s) => s.reason)).toContain("file not found: pakta/ana.pdf");
  });
});
