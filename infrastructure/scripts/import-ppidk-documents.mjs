#!/usr/bin/env node
/**
 * Imports letters, certificates and the agenda book from PPIDK (block J, step 4.10, DEC-10):
 * letter types, outgoing letters (with their ORIGINAL numbers and verification codes, frozen
 * signers and archived PDFs), certificate batches and sheets, incoming letters with their
 * dispositions, and every counter set to the last PPIDK number. Run locally by the owner with the
 * admin service account AFTER the people import (step 3.9) and after freezing the PPIDK letter
 * screens. Dry run unless --apply is given; safe to run again (ids come from PPIDK).
 *
 *   1. Export each table from MariaDB as TSV into one folder, e.g.
 *        for t in users org_units letter_types letter_sequences letters certificates \
 *                 incoming_letters incoming_letter_sequences letter_dispositions; do
 *          mysql --batch -e "SELECT * FROM $t" asiania_my > ppidk/$t.tsv; done
 *   2. Download the archived PDFs (R2 bucket, `surat/...`, and the incoming scans) into one
 *      folder, keeping their paths.
 *   3. node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *        --env-file=apps/admin/.env.local infrastructure/scripts/import-ppidk-documents.mjs \
 *        --dir ./ppidk [--files ./ppidk-r2] [--apply]
 *   4. Read the report (ppidk/import-documents-report.json): counts and every skipped row.
 *
 * Files: only real PDFs (checked by their first bytes) found under --files are referenced and
 * copied privately into FILE_STORAGE_DIR; an upload-path PDF whose sha256 differs from the one
 * PPIDK recorded is not imported. Run it where FILE_STORAGE_DIR is (cPanel Terminal) with --files.
 * It refuses to run when a letter type code or a verification code already belongs to a platform
 * document, and never lowers a counter the platform has already moved past.
 * Needs DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (and
 * FILE_STORAGE_DIR with --files).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mapPpidkDocuments, PPIDK_DOCUMENT_TABLES } from "../../packages/db/src/ppidk/documents.ts";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import { getDocumentsByIds } from "../../packages/db/src/sql/batch.ts";
import { getDatabase } from "../../packages/db/src/sql/store.ts";
import { createDiskFileStorage } from "../../packages/db/src/sql/storage.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    files: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (!values.dir) {
  console.error(
    "Usage: import-ppidk-documents.mjs --dir <folder with the .tsv files> [--files <PPIDK PDFs>] [--apply]",
  );
  process.exit(2);
}
const required = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];
if (values.files) required.push("FILE_STORAGE_DIR");
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

// firebase-admin (Authentication only) is a dependency of @website/auth; resolve it from there.
const require = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const { cert, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const app = initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const auth = getAuth(app);
const db = getDatabase({ url: process.env.DATABASE_URL });

const tables = Object.fromEntries(
  PPIDK_DOCUMENT_TABLES.map((name) => [
    name,
    parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8")),
  ]),
);

// Periods, units and accounts come from the people import: refuse to run before it.
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
/** Size and sha256 of a real PDF (starts with "%PDF-"), else null. */
const file = (ppidkPath) => {
  const full = localPath(ppidkPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  const bytes = readFileSync(full);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
};

const plan = mapPpidkDocuments(tables, { uidOf, file, now: new Date() });

/** Writes into one collection, by document id. */
const planned = (collection) =>
  plan.writes.filter((w) => w.path.startsWith(`${collection}/`)).map((w) => w.path.split("/")[1]);
const current = async (collection) => getDocumentsByIds(db, collection, planned(collection));

// A code (type code or verification code) taken by a platform document stops the import.
const conflicts = [];
for (const [code, data] of await current("letterTypeCodes")) {
  if (data && !String(data.id).startsWith("ppidk-")) conflicts.push(`letter type code ${code}`);
}
for (const [code, data] of await current("verificationCodes")) {
  if (data && !String(data.letterId).startsWith("ppidk-")) {
    conflicts.push(`verification code ${code}`);
  }
}
// Never lower a counter: a number the platform already gave out stays given out.
for (const collection of ["letterCounters", "certificateCounters", "incomingCounters"]) {
  const now = await current(collection);
  for (const write of plan.writes.filter((w) => w.path.startsWith(`${collection}/`))) {
    const last = now.get(write.path.split("/")[1])?.last ?? 0;
    if (last > write.data.last) write.data.last = last;
  }
}

const report = {
  dryRun: !values.apply,
  counts: plan.counts,
  conflicts,
  skipped: plan.skipped,
};
writeFileSync(
  join(values.dir, "import-documents-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
if (conflicts.length > 0) {
  console.error("Already used by platform documents: nothing written. See the report.");
  process.exit(1);
}
if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}

// Files first: a document never points to a file that is not uploaded.
if (plan.files.length > 0) {
  const storage = createDiskFileStorage({
    root: process.env.FILE_STORAGE_DIR,
    baseUrl: "",
    secret: undefined,
  });
  for (const f of plan.files) {
    await storage.save(f.to, readFileSync(localPath(f.from)), {
      visibility: "private",
      contentType: f.contentType,
    });
  }
}

for (let i = 0; i < plan.writes.length; i += 400) {
  const batch = db.batch();
  for (const write of plan.writes.slice(i, i + 400)) batch.set(db.doc(write.path), write.data);
  await batch.commit();
}
console.log(`Done: ${plan.writes.length} documents written, ${plan.files.length} files copied.`);
await db.close();
