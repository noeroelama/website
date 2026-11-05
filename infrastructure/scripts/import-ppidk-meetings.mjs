#!/usr/bin/env node
/**
 * Imports meetings (participants, agenda, minutes, action items), Zoom bookings and recorded
 * sessions, short links and the outgoing message log from PPIDK (block J, step 7.12, DEC-10). Run
 * locally by the owner with the admin service account AFTER the people import (step 3.9) and
 * after freezing the PPIDK meeting, Zoom and Tools screens. Dry run unless --apply is given; safe
 * to run again (ids come from PPIDK).
 *
 *   1. Export each table from MariaDB as TSV into one folder, e.g.
 *        for t in users org_units meetings meeting_participants meeting_agenda_items \
 *                 meeting_action_items zoom_meetings zoom_recording_sessions shortlinks \
 *                 outgoing_messages; do
 *          mysql --batch -e "SELECT * FROM $t" asiania_my > ppidk/$t.tsv; done
 *   2. node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *        --env-file=apps/admin/.env.local infrastructure/scripts/import-ppidk-meetings.mjs \
 *        --dir ./ppidk [--apply]
 *   3. Read the report (ppidk/import-meetings-report.json): counts and every skipped row.
 *
 * Needs DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import { mapPpidkMeetings, PPIDK_MEETING_TABLES } from "../../packages/db/src/ppidk/meetings.ts";
import { getDatabase } from "../../packages/db/src/sql/store.ts";

const { values } = parseArgs({
  options: { dir: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.dir) {
  console.error("Usage: import-ppidk-meetings.mjs --dir <folder with the .tsv files> [--apply]");
  process.exit(2);
}
const required = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

// firebase-admin (Authentication only) is a dependency of @website/auth; resolve it from there.
const require = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const auth = getAuth(
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  }),
);
const db = getDatabase({ url: process.env.DATABASE_URL });

const read = (name) => parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8"));
const tables = Object.fromEntries(PPIDK_MEETING_TABLES.map((name) => [name, read(name)]));
const users = read("users");

const periods = await db.collection("periods").get();
if (!periods.docs.some((doc) => doc.id.startsWith("ppidk-"))) {
  console.error("Run the people import first (import-ppidk-people.mjs).");
  process.exit(1);
}

// Same accounts as the people import: existing ones by e-mail, otherwise ppidk-<id>.
const existing = new Map();
const emails = users.map((u) => u.email?.trim().toLowerCase()).filter(Boolean);
for (let i = 0; i < emails.length; i += 100) {
  const found = await auth.getUsers(emails.slice(i, i + 100).map((email) => ({ email })));
  for (const user of found.users) existing.set(user.email.toLowerCase(), user.uid);
}
const emailOf = new Map(users.map((u) => [u.id, u.email?.trim().toLowerCase()]));
const uidOf = (ppidkId) => existing.get(emailOf.get(ppidkId)) ?? `ppidk-${ppidkId}`;

const plan = mapPpidkMeetings(tables, { uidOf, now: new Date() });
const report = { dryRun: !values.apply, counts: plan.counts, skipped: plan.skipped };
writeFileSync(
  join(values.dir, "import-meetings-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}
for (let i = 0; i < plan.writes.length; i += 400) {
  const batch = db.batch();
  for (const write of plan.writes.slice(i, i + 400)) batch.set(db.doc(write.path), write.data);
  await batch.commit();
}
console.log(`Done: ${plan.writes.length} documents written.`);
await db.close();
