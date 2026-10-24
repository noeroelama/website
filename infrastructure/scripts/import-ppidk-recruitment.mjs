#!/usr/bin/env node
/**
 * Imports forms and recruitment from PPIDK (block J, step 5.8): forms with their versions and
 * responses, recruitments, applications (latest per person, with choices, revision rounds and
 * interviews), interview slots and personality results. Run locally by the owner with the admin
 * service account AFTER the people import (step 3.9) and after freezing the PPIDK form and
 * recruitment screens. Dry run unless --apply is given; safe to run again (ids come from PPIDK).
 *
 *   1. Export each table from MariaDB as TSV into one folder, e.g.
 *        for t in users org_units forms form_versions form_responses recruitments \
 *                 recruitment_applications application_choices application_revisions \
 *                 interview_slots interviews personality_results; do
 *          mysql --batch -e "SELECT * FROM $t" asiania_my > ppidk/$t.tsv; done
 *   2. Optional: copy PPIDK's private storage folder (storage/app/private) next to it.
 *   3. node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *        --env-file=apps/admin/.env.local infrastructure/scripts/import-ppidk-recruitment.mjs \
 *        --dir ./ppidk [--files ./ppidk-private] [--apply]
 *   4. Read the report (ppidk/import-recruitment-report.json): counts and every skipped row.
 *
 * Files: only real PDFs (checked by their first bytes) found under --files are referenced and
 * uploaded privately to FIREBASE_STORAGE_BUCKET; without --files no file is referenced.
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (and
 * FIREBASE_STORAGE_BUCKET with --files).
 */
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import {
  mapPpidkRecruitment,
  PPIDK_RECRUITMENT_TABLES,
} from "../../packages/db/src/ppidk/recruitment.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    files: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (!values.dir) {
  console.error(
    "Usage: import-ppidk-recruitment.mjs --dir <folder with the .tsv files> [--files <PPIDK private storage>] [--apply]",
  );
  process.exit(2);
}
const required = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
if (values.files) required.push("FIREBASE_STORAGE_BUCKET");
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

// firebase-admin is a dependency of @website/db; resolve it from there.
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

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
  PPIDK_RECRUITMENT_TABLES.map((name) => [
    name,
    parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8")),
  ]),
);

// Org units and periods come from the people import: refuse to run before it.
const periods = await db.collection("periods").get();
if (!periods.docs.some((doc) => doc.id.startsWith("ppidk-"))) {
  console.error("Run the people import first (import-ppidk-people.mjs).");
  process.exit(1);
}

// Same accounts as the people import: existing ones by e-mail, otherwise ppidk-<id>.
const existing = new Map();
const emails = tables.users.map((u) => u.email?.trim().toLowerCase()).filter(Boolean);
for (let i = 0; i < emails.length; i += 100) {
  const found = await auth.getUsers(emails.slice(i, i + 100).map((email) => ({ email })));
  for (const user of found.users) existing.set(user.email.toLowerCase(), user.uid);
}
const emailOf = new Map(tables.users.map((u) => [u.id, u.email?.trim().toLowerCase()]));
const uidOf = (ppidkId) => existing.get(emailOf.get(ppidkId)) ?? `ppidk-${ppidkId}`;

/** A PPIDK path inside --files (never outside it), or null. */
const localPath = (ppidkPath) => {
  if (!values.files) return null;
  const root = resolve(values.files);
  const full = resolve(root, ppidkPath);
  const inside = relative(root, full);
  return inside && !inside.startsWith("..") ? full : null;
};
/** Size of a real PDF (starts with "%PDF-"), else null. */
const fileSize = (ppidkPath) => {
  const full = localPath(ppidkPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  const head = Buffer.alloc(5);
  const fd = openSync(full, "r");
  readSync(fd, head, 0, 5, 0);
  closeSync(fd);
  return head.toString("latin1") === "%PDF-" ? statSync(full).size : null;
};

const plan = mapPpidkRecruitment(tables, { uidOf, fileSize, now: new Date() });
const report = {
  dryRun: !values.apply,
  counts: plan.counts,
  skipped: plan.skipped,
};
writeFileSync(
  join(values.dir, "import-recruitment-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}

// Files first: a document never points to a file that is not uploaded.
if (plan.files.length > 0) {
  const bucket = getStorage(app).bucket(process.env.FIREBASE_STORAGE_BUCKET);
  for (const file of plan.files) {
    await bucket.upload(localPath(file.from), {
      destination: file.to,
      resumable: false,
      metadata: { contentType: file.contentType },
    });
  }
}

for (let i = 0; i < plan.writes.length; i += 400) {
  const batch = db.batch();
  for (const write of plan.writes.slice(i, i + 400)) batch.set(db.doc(write.path), write.data);
  await batch.commit();
}
console.log(`Done: ${plan.writes.length} documents written, ${plan.files.length} files copied.`);
