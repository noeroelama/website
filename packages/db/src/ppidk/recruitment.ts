import {
  MAX_OPTIONS,
  type AnswerValue,
  type FileAnswer,
  type FormStatus,
  type Question,
  type QuestionType,
} from "@website/domain/forms";
import {
  APPLICATION_STATUSES,
  applicationId,
  revisionDocId,
  seatCounterId,
  type ApplicationStatus,
} from "@website/domain/recruitment";
import type { PlannedWrite, TsvRow } from "./people";

export const PPIDK_RECRUITMENT_TABLES = [
  "users",
  "org_units",
  "forms",
  "form_versions",
  "form_responses",
  "recruitments",
  "recruitment_applications",
  "application_choices",
  "application_revisions",
  "interview_slots",
  "interviews",
  "personality_results",
] as const;
export type PpidkRecruitmentTables = Readonly<
  Record<(typeof PPIDK_RECRUITMENT_TABLES)[number], readonly TsvRow[]>
>;

export interface PlannedFile {
  readonly from: string;
  readonly to: string;
  readonly contentType: "application/pdf";
}

export interface PpidkRecruitmentPlan {
  readonly writes: PlannedWrite[];
  readonly files: PlannedFile[];
  readonly skipped: Array<{ table: string; id: string; reason: string }>;
  readonly counts: Record<string, number>;
}

const TYPES: Readonly<Record<string, QuestionType>> = {
  text: "short_text",
  textarea: "long_text",
  number: "number",
  date: "date",
  select: "single_choice",
  multiselect: "multi_choice",
  file: "file",
  url: "short_text",
};

const FORM_STATUS: Readonly<Record<string, FormStatus>> = {
  draft: "draft",
  open: "published",
  closed: "closed",
};

const HOLDS_SEAT: readonly ApplicationStatus[] = [
  "accepted",
  "approved",
  "pakta_review",
  "confirmed",
];

const RESPONDENT_NAME = "q_respondentname";
const RESPONDENT_EMAIL = "q_respondentemail";

const at = (value: string | null | undefined) => (value ? new Date(`${value}Z`) : null);
const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const text = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");
const byNumber = (field: string) => (a: TsvRow, b: TsvRow) =>
  Number(a[field] ?? 0) - Number(b[field] ?? 0);

interface PpidkField {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  help?: string | null;
  options?: string[];
}

function questionIds() {
  const ids = new Map<string, string>();
  return (key: string) => {
    const known = ids.get(key);
    if (known) return known;
    const base = `q_${key.replace(/[^A-Za-z0-9]/g, "").slice(0, 28) || "field"}`;
    let id = base;
    for (let n = 2; [...ids.values()].includes(id); n += 1) id = `${base}${n}`;
    ids.set(key, id);
    return id;
  };
}

export function mapPpidkRecruitment(
  tables: PpidkRecruitmentTables,
  options: {
    uidOf: (ppidkUserId: string) => string;
    fileSize: (ppidkPath: string) => number | null;
    now: Date;
  },
): PpidkRecruitmentPlan {
  const { now } = options;
  const writes: PlannedWrite[] = [];
  const files: PlannedFile[] = [];
  const skipped: PpidkRecruitmentPlan["skipped"] = [];
  const set = (path: string, data: Record<string, unknown>) =>
    writes.push({ path, data, mode: "set" });
  const id = (table: string, value: string | null | undefined) => `ppidk-${table}-${value ?? ""}`;
  const known = new Set(tables.users.filter((u) => u["email"]).map((u) => u["id"] ?? ""));
  const uid = (ppidkUserId: string | null | undefined) =>
    ppidkUserId && known.has(ppidkUserId) ? options.uidOf(ppidkUserId) : null;
  const pdf = (
    table: string,
    rowId: string,
    from: string | null | undefined,
    to: string,
    name: string,
  ) => {
    if (!from) return null;
    if (!from.toLowerCase().endsWith(".pdf")) {
      skipped.push({ table, id: rowId, reason: `file not imported (only PDFs): ${from}` });
      return null;
    }
    const size = options.fileSize(from);
    if (!size) {
      skipped.push({ table, id: rowId, reason: `file not found: ${from}` });
      return null;
    }
    files.push({ from, to, contentType: "application/pdf" });
    const file: FileAnswer = { path: to, name, contentType: "application/pdf", size };
    return file;
  };

  const versionsOf = new Map<string, TsvRow[]>();
  for (const v of [...tables.form_versions].sort(byNumber("version"))) {
    const list = versionsOf.get(v["form_id"] ?? "") ?? [];
    list.push(v);
    versionsOf.set(v["form_id"] ?? "", list);
  }
  const versionNumber = new Map(
    tables.form_versions.map((v) => [v["id"] ?? "", Number(v["version"])]),
  );
  const answeredVersions = new Set([
    ...tables.form_responses.map((r) => r["form_version_id"] ?? ""),
    ...tables.recruitment_applications
      .filter((a) => a["status"] !== "draft")
      .map((a) => a["form_version_id"] ?? ""),
  ]);
  const idOfField = new Map<string, (key: string) => string>();
  const fieldsOf = new Map<string, Question[]>();
  const formById = new Map(tables.forms.map((f) => [f["id"] ?? "", f]));

  for (const f of tables.forms) {
    const formId = id("form", f["id"]);
    const versions = versionsOf.get(f["id"] ?? "") ?? [];
    const toId = questionIds();
    idOfField.set(f["id"] ?? "", toId);
    const guest = f["respondent_mode"] === "guest";
    for (const v of versions) {
      const questions: Question[] =
        json<{ fields?: PpidkField[] }>(v["schema"], {}).fields?.flatMap((field): Question[] => {
          const type = TYPES[field.type ?? "text"] ?? "short_text";
          const options = (field.options ?? []).slice(0, MAX_OPTIONS);
          const choice = type === "single_choice" || type === "multi_choice";
          if (choice && options.length < 2) {
            skipped.push({
              table: "form_versions",
              id: v["id"] ?? "",
              reason: `"${field.label ?? ""}" has fewer than 2 options: imported as a short answer`,
            });
          }
          return [
            {
              id: toId(field.key ?? field.label ?? "field"),
              type: choice && options.length < 2 ? "short_text" : type,
              label: (field.label ?? "").slice(0, 300),
              description: (field.help ?? "").slice(0, 1000),
              required: field.required === true,
              options: choice && options.length >= 2 ? options : [],
              allowOther: false,
              maxSelections: null,
              min: null,
              max: null,
            },
          ];
        }) ?? [];
      if (guest) {
        questions.push(
          { ...identity(RESPONDENT_NAME, "Nama"), type: "short_text" },
          { ...identity(RESPONDENT_EMAIL, "E-mail"), type: "email" },
        );
      }
      fieldsOf.set(v["id"] ?? "", questions);
      set(`formVersions/${formId}_${v["version"] ?? ""}`, {
        formId,
        number: Number(v["version"]),
        questions,
        answered: answeredVersions.has(v["id"] ?? ""),
        createdAt: at(v["created_at"]) ?? now,
      });
    }
    const latest = versions.at(-1);
    if (!latest) {
      skipped.push({ table: "forms", id: f["id"] ?? "", reason: "no version: not imported" });
      continue;
    }
    const recruitment = f["type"] === "recruitment";
    if (!recruitment && f["respondent_mode"] === "member") {
      skipped.push({
        table: "forms",
        id: f["id"] ?? "",
        reason: "members-only form imported as a public (guest) form",
      });
    }
    set(`forms/${formId}`, {
      title: (f["title"] ?? "").slice(0, 120),
      description: f["description"] ?? "",
      usage: recruitment ? "recruitment" : "public",
      status: recruitment ? "draft" : (FORM_STATUS[f["status"] ?? ""] ?? "draft"),
      publicToken: recruitment ? null : (f["public_token"] ?? null),
      currentVersion: Number(latest["version"]),
      opensAt: at(f["opens_at"])?.toISOString() ?? null,
      closesAt: at(f["closes_at"])?.toISOString() ?? null,
      responseCount: tables.form_responses.filter((r) => r["form_id"] === f["id"]).length,
      version: 1,
      createdAt: at(f["created_at"]) ?? now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  const answersOf = (
    formPpidkId: string,
    versionId: string,
    data: string | null | undefined,
    table: string,
    rowId: string,
    filePath: (key: string, n: number) => string,
  ): Record<string, AnswerValue> => {
    const toId = idOfField.get(formPpidkId);
    const questions = fieldsOf.get(versionId) ?? [];
    const raw = json<Record<string, unknown>>(data, {});
    const answers: Record<string, AnswerValue> = {};
    let n = 0;
    for (const [key, value] of Object.entries(raw)) {
      const question = toId && questions.find((q) => q.id === toId(key));
      if (!question || value === null || value === "" || value === undefined) continue;
      if (question.type === "file") {
        const file = pdf(table, rowId, text(value), filePath(key, (n += 1)), `${key}.pdf`);
        if (file) answers[question.id] = file;
      } else if (question.type === "multi_choice") {
        answers[question.id] = (Array.isArray(value) ? (value as unknown[]) : [value]).map(text);
      } else if (question.type === "number" && !Number.isNaN(Number(value))) {
        answers[question.id] = Number(value);
      } else {
        answers[question.id] = text(value);
      }
    }
    return answers;
  };

  for (const r of tables.form_responses) {
    const form = formById.get(r["form_id"] ?? "");
    if (!form || form["type"] === "recruitment") continue;
    const formId = id("form", r["form_id"]);
    const answers = answersOf(
      r["form_id"] ?? "",
      r["form_version_id"] ?? "",
      r["data"],
      "form_responses",
      r["id"] ?? "",
      (_key, n) => `forms/${formId}/ppidk_${r["id"] ?? ""}_${n}.pdf`,
    );
    if (form["respondent_mode"] === "guest") {
      if (r["respondent_name"]) answers[RESPONDENT_NAME] = r["respondent_name"];
      if (r["respondent_email"]) answers[RESPONDENT_EMAIL] = r["respondent_email"];
    }
    set(`formResponses/${id("response", r["id"])}`, {
      formId,
      version: versionNumber.get(r["form_version_id"] ?? "") ?? 1,
      answers,
      submittedAt: at(r["submitted_at"]) ?? now,
    });
  }

  const recruitmentOf = new Map<string, string>();
  for (const r of tables.recruitments) {
    const form = formById.get(r["form_id"] ?? "");
    if (!form || !versionsOf.get(r["form_id"] ?? "")?.length) {
      skipped.push({ table: "recruitments", id: r["id"] ?? "", reason: "no form: not imported" });
      continue;
    }
    const recruitmentId = id("recruitment", r["id"]);
    recruitmentOf.set(r["id"] ?? "", recruitmentId);
    const offered = tables.org_units.filter(
      (u) => u["period_id"] === r["period_id"] && u["active_for_selection"] === "1",
    );
    const holding = tables.recruitment_applications.filter(
      (a) =>
        a["recruitment_id"] === r["id"] && HOLDS_SEAT.includes(a["status"] as ApplicationStatus),
    );
    const opensAt = at(form["opens_at"]) ?? at(r["created_at"]) ?? now;
    if (r["pakta_template_path"]) {
      skipped.push({
        table: "recruitments",
        id: r["id"] ?? "",
        reason: `pact template is a file (${r["pakta_template_path"]}): set its link on the Recruitment page`,
      });
    }
    set(`recruitments/${recruitmentId}`, {
      periodId: id("period", r["period_id"]),
      title: (form["title"] ?? "").slice(0, 160),
      description: form["description"] ?? "",
      opensAt: opensAt.toISOString(),
      closesAt: (
        at(form["closes_at"]) ?? new Date(opensAt.getTime() + 30 * 86_400_000)
      ).toISOString(),
      maxChoices: Math.min(5, Math.max(1, Number(r["choice_count"] ?? 2))),
      units: offered.map((u) => ({
        orgUnitId: id("unit", u["id"]),
        name: u["name"] ?? "",
        quota: u["quota"] ? Number(u["quota"]) : 500,
        portfolioRequired: u["requires_portfolio"] === "1",
      })),
      offerDays: 3,
      formId: id("form", r["form_id"]),
      formVersion: Number(versionsOf.get(r["form_id"] ?? "")?.at(-1)?.["version"]),
      pactTemplateUrl: null,
      published: form["status"] !== "draft",
      version: 1,
      createdAt: at(r["created_at"]) ?? now,
      updatedAt: now,
      deletedAt: null,
    });
    for (const u of offered) {
      set(`seatCounters/${seatCounterId(recruitmentId, id("unit", u["id"]))}`, {
        recruitmentId,
        orgUnitId: id("unit", u["id"]),
        quota: u["quota"] ? Number(u["quota"]) : 500,
        filled: holding.filter((a) => a["offered_org_unit_id"] === u["id"]).length,
      });
    }
  }

  const bookings = tables.interviews.filter(
    (i) => i["status"] === "booked" || i["status"] === "attended",
  );
  for (const s of tables.interview_slots) {
    const recruitmentId = recruitmentOf.get(s["recruitment_id"] ?? "");
    if (!recruitmentId) continue;
    const startsAt = at(s["starts_at"]) ?? now;
    const endsAt = at(s["ends_at"]) ?? startsAt;
    const booked = bookings.filter((i) => i["interview_slot_id"] === s["id"]).length;
    set(`interviewSlots/${id("slot", s["id"])}`, {
      recruitmentId,
      startsAt,
      durationMinutes: Math.max(5, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
      capacity: Number(s["capacity"] ?? 1),
      booked,
      location: s["location"] ?? "",
      deletedAt: s["is_open"] === "0" && booked === 0 ? now : null,
    });
  }

  const latestPerPerson = new Map<string, TsvRow>();
  for (const a of [...tables.recruitment_applications].sort(byNumber("id"))) {
    const key = `${a["recruitment_id"] ?? ""}|${a["user_id"] ?? ""}`;
    const earlier = latestPerPerson.get(key);
    if (earlier) {
      skipped.push({
        table: "recruitment_applications",
        id: earlier["id"] ?? "",
        reason: "an older application of the same person: only the latest is kept",
      });
    }
    latestPerPerson.set(key, a);
  }
  for (const a of latestPerPerson.values()) {
    const recruitmentId = recruitmentOf.get(a["recruitment_id"] ?? "");
    const applicant = uid(a["user_id"]);
    const status = a["status"] as ApplicationStatus;
    if (!recruitmentId || !applicant || !APPLICATION_STATUSES.includes(status)) {
      skipped.push({
        table: "recruitment_applications",
        id: a["id"] ?? "",
        reason: !recruitmentId
          ? "recruitment not imported"
          : !applicant
            ? "unknown user"
            : `status ${a["status"] ?? ""}`,
      });
      continue;
    }
    const recruitment = tables.recruitments.find((r) => r["id"] === a["recruitment_id"]);
    const appId = applicationId(recruitmentId, applicant);
    const choices = tables.application_choices
      .filter((c) => c["application_id"] === a["id"])
      .sort(byNumber("rank"));
    const portfolio = choices.reduce<FileAnswer | null>(
      (found, c) =>
        found ??
        pdf(
          "application_choices",
          c["id"] ?? "",
          c["portfolio_path"],
          `recruitment/${recruitmentId}/${applicant}/portfolio_ppidk_${c["id"] ?? ""}.pdf`,
          "portfolio.pdf",
        ),
      null,
    );
    const rounds = tables.application_revisions
      .filter((r) => r["application_id"] === a["id"])
      .sort(byNumber("id"));
    rounds.forEach((r, i) => {
      const fields = json<Array<{ key?: string; note?: string }>>(r["fields"], []);
      const request = [
        r["note"] ?? "",
        ...fields.map((f) => `- ${f.key ?? ""}${f.note ? `: ${f.note}` : ""}`),
      ]
        .filter(Boolean)
        .join("\n");
      set(`applicationRevisions/${revisionDocId(appId, i + 1)}`, {
        applicationId: appId,
        recruitmentId,
        round: i + 1,
        request: request || "(no note)",
        requestedAt: at(r["created_at"]) ?? now,
        requestedBy: uid(r["requested_by_user_id"]) ?? "ppidk",
        resubmittedAt: at(r["resubmitted_at"]),
      });
    });
    const booking = bookings.find((i) => i["application_id"] === a["id"]);
    const slot =
      booking && tables.interview_slots.find((s) => s["id"] === booking["interview_slot_id"]);
    const pact = pdf(
      "recruitment_applications",
      a["id"] ?? "",
      a["pakta_path"],
      `recruitment/${recruitmentId}/${applicant}/pact_ppidk_${a["id"] ?? ""}.pdf`,
      "pakta.pdf",
    );
    set(`applications/${appId}`, {
      recruitmentId,
      userId: applicant,
      status,
      choices: choices.map((c) => id("unit", c["org_unit_id"])),
      answers: answersOf(
        recruitment?.["form_id"] ?? "",
        a["form_version_id"] ?? "",
        a["data"],
        "recruitment_applications",
        a["id"] ?? "",
        (_key, n) =>
          `forms/${id("form", recruitment?.["form_id"])}/${applicant}_ppidk_${a["id"] ?? ""}_${n}.pdf`,
      ),
      portfolio,
      revisionRound: rounds.length,
      offer: a["offered_org_unit_id"]
        ? {
            orgUnitId: id("unit", a["offered_org_unit_id"]),
            expiresAt: at(a["offer_deadline"]) ?? at(a["offered_at"]) ?? now,
          }
        : null,
      interview: slot
        ? { slotId: id("slot", slot["id"]), startsAt: at(slot["starts_at"]) ?? now }
        : null,
      pacts: pact ? [pact] : [],
      pactNote: a["pakta_rejection_note"] ?? null,
      appointmentId: null,
      submittedAt: at(a["submitted_at"]),
      version: 1,
      createdAt: at(a["created_at"]) ?? now,
      updatedAt: now,
    });
  }

  for (const p of tables.personality_results) {
    const owner = uid(p["user_id"]);
    if (!owner) {
      skipped.push({ table: "personality_results", id: p["id"] ?? "", reason: "unknown user" });
      continue;
    }
    const axes = json<Record<string, { letter?: string; pct?: number; lean?: number }>>(
      p["axes"],
      {},
    );
    set(`personalityResults/${owner}`, {
      code: p["code"],
      identity: p["identity"],
      full: p["full"],
      axes: Object.fromEntries(
        Object.entries(axes).map(([axis, s]) => [
          axis,
          { letter: s.letter ?? "", pct: s.pct ?? 50, lean: s.lean ?? 0 },
        ]),
      ),
      completedAt: at(p["taken_at"]) ?? now,
    });
  }

  const counts: Record<string, number> = {};
  for (const w of writes) {
    const collection = w.path.split("/")[0] ?? "";
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  counts["files"] = files.length;
  return { writes, files, skipped, counts };
}

function identity(questionId: string, label: string): Omit<Question, "type"> {
  return {
    id: questionId,
    label,
    description: "",
    required: false,
    options: [],
    allowOther: false,
    maxSelections: null,
    min: null,
    max: null,
  };
}
