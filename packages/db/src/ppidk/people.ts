/**
 * PPIDK → platform import of people and the organisation (block J, step 3.9): pure mapping from
 * the MariaDB tables (exported as TSV) to Firestore documents. The local script
 * infrastructure/scripts/import-ppidk-people.mjs reads the files, resolves Firebase uids, and
 * writes what this returns. Every id is derived from the PPIDK id (`ppidk-…`), so a second run
 * writes the same documents again (idempotent).
 */
import {
  normalizeUniversityName,
  PRIVACY_POLICY_VERSION,
  type EducationLevel,
} from "@website/domain/members";
import {
  derivedAssignments,
  ORG_UNIT_TYPES,
  type AppointmentRoleMap,
  type AppointmentSeat,
  type OrgUnitType,
} from "@website/domain/organizations";

export type TsvRow = Readonly<Record<string, string | null>>;

/**
 * `mysql --batch` output: a header line, tab-separated values, `NULL` for null and the escapes
 * \\t, \\n, \\r, \\0 and \\\\ inside values.
 */
export function parseTsv(text: string): TsvRow[] {
  const unescape = (value: string) =>
    value.replace(/\\(.)/g, (_, c: string) =>
      c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "\r" : c === "0" ? "\0" : c,
    );
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(
      header.map((name, i) => {
        const cell = cells[i] ?? "NULL";
        return [name, cell === "NULL" ? null : unescape(cell)];
      }),
    );
  });
}

/** The tables the import reads (one `<name>.tsv` file each). */
export const PPIDK_TABLES = [
  "users",
  "chapters",
  "universities",
  "periods",
  "org_units",
  "profiles",
  "appointments",
  "role_assignments",
  "provinces",
  "regencies",
] as const;
export type PpidkTables = Readonly<Record<(typeof PPIDK_TABLES)[number], readonly TsvRow[]>>;

export interface PpidkPerson {
  readonly ppidkId: string;
  readonly email: string;
  readonly name: string;
  readonly active: boolean;
}

/** `set` replaces the document; `user` adds to an account that may exist already. */
export interface PlannedWrite {
  readonly path: string;
  readonly data: Record<string, unknown>;
  readonly mode: "set" | "user";
}

export interface PpidkPlan {
  readonly people: PpidkPerson[];
  readonly writes: PlannedWrite[];
  readonly skipped: Array<{ table: string; id: string; reason: string }>;
  readonly counts: Record<string, number>;
}

const DEGREES: Readonly<Record<string, EducationLevel>> = {
  d3: "diploma",
  d4: "diploma",
  s1: "bachelor",
  s2: "master",
  s3: "doctoral",
  profesi: "non_degree",
  non_gelar: "non_degree",
};
const CORE_TITLES = /sekretaris/i;
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const flag = (value: string | null | undefined) => value === "1";
const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

/**
 * Maps the PPIDK tables. `uidOf` gives the Firebase uid of a PPIDK user (an existing account with
 * the same e-mail, or `ppidk-<id>` created by the script); `roleMap` is
 * `settings/appointmentRoles`, so active appointments of the active period get their roles.
 * Manual PPIDK role assignments are not imported (roles are data here; they are listed in
 * `skipped` so the owner can grant them again on the Users page).
 */
export function mapPpidk(
  tables: PpidkTables,
  options: {
    uidOf: (ppidkUserId: string) => string;
    roleMap: AppointmentRoleMap;
    now: Date;
    /** Chapters staff already added (country code → id): reused, not imported again. */
    chapterIdByCountry?: ReadonlyMap<string, string>;
  },
): PpidkPlan {
  const { uidOf, roleMap, now } = options;
  const writes: PlannedWrite[] = [];
  const skipped: PpidkPlan["skipped"] = [];
  const set = (path: string, data: Record<string, unknown>) =>
    writes.push({ path, data, mode: "set" });
  const meta = { version: 1, createdAt: now, updatedAt: now, deletedAt: null };
  const id = (table: string, value: string | null | undefined) => `ppidk-${table}-${value ?? ""}`;
  const users = new Map(tables.users.map((u) => [u["id"] ?? "", u]));
  const people: PpidkPerson[] = tables.users.flatMap((u) => {
    const email = u["email"]?.trim().toLowerCase();
    if (!email) {
      skipped.push({ table: "users", id: u["id"] ?? "", reason: "no e-mail" });
      return [];
    }
    return [
      { ppidkId: u["id"] ?? "", email, name: u["name"] ?? email, active: u["is_active"] !== "0" },
    ];
  });
  const known = new Set(people.map((p) => p.ppidkId));
  const uid = (ppidkUserId: string | null | undefined) =>
    ppidkUserId && known.has(ppidkUserId) ? uidOf(ppidkUserId) : null;

  // Chapters (A2): map position and public contact are filled in by staff afterwards.
  const chapterId = new Map<string, string>();
  const chapterCountry = new Map<string, string>();
  for (const c of tables.chapters) {
    const existing = options.chapterIdByCountry?.get(c["country_code"] ?? "");
    const docId = existing ?? id("chapter", c["id"]);
    chapterId.set(c["id"] ?? "", docId);
    chapterCountry.set(c["id"] ?? "", c["country_code"] ?? "");
    if (existing) continue;
    set(`chapters/${docId}`, {
      slug: c["slug"],
      name: c["name"],
      countryCode: c["country_code"],
      active: flag(c["is_active"]),
      timezone: c["timezone"],
      logo: null,
      contactName: "",
      contactPublic: "",
      website: c["website"],
      email: c["email"],
      instagram: c["instagram"],
      socials: [],
      latitude: 0,
      longitude: 0,
      ...meta,
    });
    set(`chapterSlugs/${c["slug"] ?? ""}`, { id: docId });
  }

  // Universities (A3): ROR rows keep the ROR import's id, proposals get their own.
  const universityId = new Map<string, string>();
  const universityName = new Map(tables.universities.map((u) => [u["id"] ?? "", u["name"] ?? ""]));
  for (const u of tables.universities) {
    const ror = u["ror_id"];
    universityId.set(
      u["id"] ?? "",
      ror ? `${ror.split("/").pop() ?? ror}_${u["country_code"] ?? ""}` : id("university", u["id"]),
    );
  }
  for (const u of tables.universities) {
    const aliases = json<string[]>(u["aliases"], []);
    const status =
      u["status"] === "approved" || u["status"] === "pending" ? u["status"] : "rejected";
    set(`universities/${universityId.get(u["id"] ?? "") ?? ""}`, {
      name: u["name"],
      normalizedName: normalizeUniversityName(u["name"] ?? ""),
      countryCode: u["country_code"],
      city: u["city"],
      website: u["website"],
      aliases,
      aliasesNormalized: aliases.map(normalizeUniversityName),
      rorId: u["ror_id"],
      source: u["ror_id"] ? "ror" : "manual",
      status,
      submittedBy: uid(u["submitted_by_user_id"]),
      mergedInto: u["merged_into_id"] ? (universityId.get(u["merged_into_id"]) ?? null) : null,
      reviewedBy: uid(u["reviewed_by_user_id"]),
      reviewedAt: u["reviewed_at"] ? new Date(`${u["reviewed_at"]}Z`) : null,
      reviewNote: u["review_note"],
      ...meta,
    });
  }

  // Periods (A1): one active (settings/activePeriod), archived ones read-only.
  let activePeriod: string | null = null;
  for (const p of tables.periods) {
    const docId = id("period", p["id"]);
    const active = flag(p["is_active"]);
    if (active) activePeriod = docId;
    set(`periods/${docId}`, {
      name: p["year_label"] ?? p["name"],
      cabinet: p["cabinet_name"] ?? "",
      startsOn: day(p["starts_on"]),
      endsOn: day(p["ends_on"]),
      vision: p["vision"] ?? "",
      mission: p["mission"] ?? "",
      lpjDeadlineDays: Number(p["lpj_deadline_days"] ?? 14),
      status: active ? "active" : p["archived_at"] ? "archived" : "draft",
      ...meta,
    });
  }
  if (activePeriod) set("settings/activePeriod", { periodId: activePeriod, updatedAt: now });

  // Org units (A5): parentId + ancestor path, code unique per period.
  const unitRows = new Map(tables.org_units.map((u) => [u["id"] ?? "", u]));
  const pathOf = (row: TsvRow): string[] => {
    const path: string[] = [];
    const seen = new Set<string>();
    for (let parent = row["parent_id"]; parent && !seen.has(parent);) {
      seen.add(parent);
      path.unshift(id("unit", parent));
      parent = unitRows.get(parent)?.["parent_id"] ?? null;
    }
    return path;
  };
  const unitType = new Map<string, OrgUnitType>();
  for (const u of tables.org_units) {
    const type = (ORG_UNIT_TYPES as readonly string[]).includes(u["type"] ?? "")
      ? (u["type"] as OrgUnitType)
      : "staf";
    const docId = id("unit", u["id"]);
    const periodId = id("period", u["period_id"]);
    unitType.set(docId, type);
    set(`orgUnits/${docId}`, {
      periodId,
      parentId: u["parent_id"] ? id("unit", u["parent_id"]) : null,
      path: pathOf(u),
      name: u["name"],
      code: (u["code"] ?? "").toUpperCase(),
      type,
      description: u["description"] ?? "",
      sort: Number(u["sort"] ?? 0),
      active: u["is_active"] !== "0",
      ...meta,
    });
    set(`orgUnitCodes/${periodId}_${(u["code"] ?? "").toUpperCase()}`, { id: docId });
  }

  // Member profiles (B3–B5): imported answers; the member agrees to the privacy policy (and
  // completes what PPIDK did not ask, e.g. the emergency contact) on the first sign-in.
  const provinces = new Map(tables.provinces.map((p) => [p["code"] ?? "", p["name"] ?? ""]));
  const regencies = new Map(tables.regencies.map((r) => [r["code"] ?? "", r["name"] ?? ""]));
  const chapterOfUser = new Map<string, string | null>();
  const verified = new Set<string>();
  for (const p of tables.profiles) {
    const owner = uid(p["user_id"]);
    if (!owner) {
      skipped.push({ table: "profiles", id: p["id"] ?? "", reason: "user not imported" });
      continue;
    }
    const chapter = p["chapter_id"] ? (chapterId.get(p["chapter_id"]) ?? null) : null;
    chapterOfUser.set(owner, chapter);
    if (p["verification_status"] === "verified") verified.add(owner);
    const person = users.get(p["user_id"] ?? "");
    set(`memberProfiles/${owner}`, {
      userId: owner,
      email: person?.["email"]?.trim().toLowerCase() ?? "",
      fullName: p["full_name"],
      gender: p["gender"] === "L" ? "male" : p["gender"] === "P" ? "female" : null,
      dateOfBirth: day(p["birth_date"]),
      ppiCountry: p["chapter_id"] ? (chapterCountry.get(p["chapter_id"]) ?? null) : null,
      university: p["university_id"] ? (universityName.get(p["university_id"]) ?? "") : "",
      universityId: p["university_id"] ? (universityId.get(p["university_id"]) ?? null) : null,
      educationLevel: DEGREES[p["degree_level"] ?? ""] ?? null,
      majors: p["major"] ? [p["major"]] : [],
      yearOfEntry: p["study_start_year"] ? Number(p["study_start_year"]) : null,
      estimatedGraduationYear: p["study_expected_end_year"]
        ? Number(p["study_expected_end_year"])
        : null,
      addressAbroad: p["address_abroad"]
        ? {
            line1: p["address_abroad"],
            city: p["city_abroad"] ?? "",
            countryCode: p["chapter_id"] ? (chapterCountry.get(p["chapter_id"]) ?? "") : "",
          }
        : null,
      addressIndonesia: p["address_home"]
        ? {
            line1: p["address_home"],
            city: regencies.get(p["home_regency_code"] ?? "") ?? "",
            province: provinces.get(p["home_province_code"] ?? "") ?? "",
          }
        : null,
      whatsappNumber: p["phone_wa"],
      emergencyContact: null,
      timezone: person?.["timezone"] ?? "UTC",
      // Not the current policy: the profile counts as incomplete until the member agrees.
      privacyPolicyVersion: `ppidk-import (current ${PRIVACY_POLICY_VERSION})`,
      consentedAt: now,
      chapterId: chapter,
      verificationStatus: verified.has(owner) ? "verified" : "unverified",
      verifiedBy: uid(p["verified_by_user_id"]),
      verifiedAt: p["verified_at"] ? new Date(`${p["verified_at"]}Z`) : null,
      graduatedOn: day(p["graduated_on"]),
      graduationMarkedBy: uid(p["graduation_marked_by_user_id"]),
      ...meta,
    });
  }

  // Appointments (B7) and the roles active ones give in the active period.
  const assignments = new Map<string, Array<{ roleId: string } & Record<string, unknown>>>();
  for (const a of tables.appointments) {
    const owner = uid(a["user_id"]);
    if (!owner) {
      skipped.push({ table: "appointments", id: a["id"] ?? "", reason: "user not imported" });
      continue;
    }
    const docId = id("appointment", a["id"]);
    const periodId = id("period", a["period_id"]);
    const orgUnitId = id("unit", a["org_unit_id"]);
    const seat: AppointmentSeat = flag(a["is_head"])
      ? "head"
      : CORE_TITLES.test(a["title"] ?? "")
        ? "secretary"
        : "member";
    const status = a["status"] === "ended" || a["status"] === "revoked" ? a["status"] : "active";
    set(`appointments/${docId}`, {
      userId: owner,
      name: users.get(a["user_id"] ?? "")?.["name"] ?? owner,
      periodId,
      orgUnitId,
      seat,
      title: a["title"],
      status,
      startsOn: day(a["starts_on"]) ?? day(a["created_at"]),
      endsOn: day(a["ends_on"]),
      ...meta,
    });
    if (status !== "active" || periodId !== activePeriod) continue;
    const type = unitType.get(orgUnitId);
    if (!type) {
      skipped.push({ table: "appointments", id: a["id"] ?? "", reason: "unit not imported" });
      continue;
    }
    const derived = derivedAssignments(seat, { id: orgUnitId, type }, roleMap).map((d) => ({
      ...d,
      periodId,
      source: "appointment",
      revokedAt: null,
      appointmentId: docId,
    }));
    assignments.set(owner, [...(assignments.get(owner) ?? []), ...derived]);
  }
  for (const r of tables.role_assignments) {
    if (r["appointment_id"] || r["revoked_at"]) continue;
    skipped.push({
      table: "role_assignments",
      id: r["id"] ?? "",
      reason: `manual role ${r["role_id"] ?? ""} (${r["scope_type"] ?? "global"}) of user ${r["user_id"] ?? ""}: grant again on the Users page`,
    });
  }

  // Accounts: the default role, member when verified, and the appointment roles.
  for (const person of people) {
    const owner = uidOf(person.ppidkId);
    const roleAssignments = [
      { roleId: "user", scope: { type: "global" } },
      ...(verified.has(owner) ? [{ roleId: "member", scope: { type: "global" } }] : []),
      ...(assignments.get(owner) ?? []),
    ].map((a) => ({
      periodId: null,
      source: "manual",
      revokedAt: null,
      appointmentId: null,
      ...a,
    }));
    writes.push({
      path: `users/${owner}`,
      mode: "user",
      data: {
        uid: owner,
        email: person.email,
        name: person.name,
        status: person.active ? "active" : "inactive",
        chapterId: chapterOfUser.get(owner) ?? null,
        roleAssignments,
        roleIds: [...new Set(roleAssignments.map((a) => a.roleId))],
        version: 1,
        createdAt: now,
        lastSignInAt: null,
      },
    });
  }

  const counts: Record<string, number> = {};
  for (const write of writes) {
    const collection = write.path.split("/")[0] ?? "";
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  return { people, writes, skipped, counts };
}
