#!/usr/bin/env node
/**
 * Imports people and the organisation from PPIDK (block J, step 3.9): users, chapters,
 * universities, periods, org units, member profiles and appointments (with the roles active
 * appointments give). Run locally by the owner with the admin service account, AFTER freezing the
 * PPIDK people screens. Dry run unless --apply is given; safe to run again (ids come from PPIDK).
 *
 *   1. Export each table from MariaDB as TSV into one folder, e.g.
 *        for t in users chapters universities periods org_units profiles appointments \
 *                 role_assignments provinces regencies; do
 *          mysql --batch -e "SELECT * FROM $t" asiania_my > ppidk/$t.tsv; done
 *   2. Set the appointment roles first (admin Structure page → Roles from appointments).
 *   3. node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *        --env-file=apps/admin/.env.local infrastructure/scripts/import-ppidk-people.mjs \
 *        --dir ./ppidk [--apply]
 *   4. Read the report (ppidk/import-report.json): counts and every skipped row.
 *
 * Accounts: a person who already signed in keeps their account (matched by e-mail) and gets the
 * imported roles added; everybody else gets a Firebase account `ppidk-<id>` with that e-mail and
 * no password: they sign in with Google or "Forgot password", then re-register passkeys.
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { mapPpidk, parseTsv, PPIDK_TABLES } from "../../packages/db/src/ppidk/people.ts";

const { values } = parseArgs({
  options: { dir: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.dir) {
  console.error("Usage: import-ppidk-people.mjs --dir <folder with the .tsv files> [--apply]");
  process.exit(2);
}
const missing = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].filter(
  (name) => !process.env[name],
);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

// firebase-admin is a dependency of @website/db; resolve it from there.
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const auth = getAuth(app);
const db = getFirestore(app);

const tables = Object.fromEntries(
  PPIDK_TABLES.map((name) => [
    name,
    parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8")),
  ]),
);
const roleMap = (await db.collection("settings").doc("appointmentRoles").get()).get("map");
if (!roleMap) {
  console.error(
    "Set the appointment roles first (admin Structure page → Roles from appointments).",
  );
  process.exit(1);
}

// Periods and the structure come from PPIDK: refuse when staff already created some here.
const periods = await db.collection("periods").get();
if (periods.docs.some((doc) => !doc.id.startsWith("ppidk-"))) {
  console.error("Periods were already created here: import into an organisation not set up yet.");
  process.exit(1);
}
// Chapters staff already added are reused (matched by country).
const chapters = await db.collection("chapters").get();
const chapterIdByCountry = new Map(
  chapters.docs.filter((d) => !d.id.startsWith("ppidk-")).map((d) => [d.get("countryCode"), d.id]),
);

// Existing Firebase accounts by e-mail (100 per lookup); the others become ppidk-<id>.
const existing = new Map();
const emails = tables.users.map((u) => u.email?.trim().toLowerCase()).filter(Boolean);
for (let i = 0; i < emails.length; i += 100) {
  const found = await auth.getUsers(emails.slice(i, i + 100).map((email) => ({ email })));
  for (const user of found.users) existing.set(user.email.toLowerCase(), user.uid);
}
const emailOf = new Map(tables.users.map((u) => [u.id, u.email?.trim().toLowerCase()]));
const uidOf = (ppidkId) => existing.get(emailOf.get(ppidkId)) ?? `ppidk-${ppidkId}`;

const plan = mapPpidk(tables, { uidOf, roleMap, now: new Date(), chapterIdByCountry });
const report = {
  dryRun: !values.apply,
  newAccounts: plan.people.filter((p) => !existing.has(p.email)).length,
  existingAccounts: plan.people.filter((p) => existing.has(p.email)).length,
  counts: plan.counts,
  skipped: plan.skipped,
};
writeFileSync(join(values.dir, "import-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}

for (const person of plan.people) {
  if (existing.has(person.email)) continue;
  await auth.createUser({
    uid: `ppidk-${person.ppidkId}`,
    email: person.email,
    displayName: person.name,
    disabled: !person.active,
  });
}

for (let i = 0; i < plan.writes.length; i += 400) {
  const chunk = plan.writes.slice(i, i + 400);
  const accounts = chunk.filter((w) => w.mode === "user").map((w) => db.doc(w.path));
  const stored = new Map(
    accounts.length > 0 ? (await db.getAll(...accounts)).map((s) => [s.ref.path, s]) : [],
  );
  const batch = db.batch();
  for (const write of chunk) {
    const current = stored.get(write.path);
    if (write.mode === "user" && current?.exists) {
      // Signed in before: keep the account and its roles; add the imported ones not yet there.
      const roles = current.get("roleAssignments") ?? [];
      const have = new Set(roles.map((a) => `${a.roleId}|${a.appointmentId ?? ""}`));
      const added = write.data.roleAssignments.filter(
        (a) => !have.has(`${a.roleId}|${a.appointmentId ?? ""}`),
      );
      const merged = [...roles, ...added];
      batch.update(db.doc(write.path), {
        roleAssignments: merged,
        roleIds: [...new Set(merged.map((a) => a.roleId))],
        chapterId: write.data.chapterId,
        version: (current.get("version") ?? 0) + 1,
      });
    } else {
      batch.set(db.doc(write.path), write.data);
    }
  }
  await batch.commit();
}
console.log(`Done: ${plan.writes.length} documents written.`);
