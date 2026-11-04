#!/usr/bin/env node
/**
 * Imports OKR, work programmes, LPJ and finance from PPIDK (block J, step 6.7, DEC-10):
 * objectives with their key results, programmes with PICs, milestones (progress recomputed) and
 * weekly check-ins, LPJs with their desks, finance requests with their desks, documents and proof
 * of transfer, and the cash book (lines of paid requests and manual lines). Run locally by the
 * owner with the admin service account AFTER the people import (step 3.9) and after freezing the
 * PPIDK proker and finance screens. Dry run unless --apply is given; safe to run again (ids come
 * from PPIDK).
 *
 *   1. Export each table from MariaDB as TSV into one folder, e.g.
 *        for t in users org_units objectives key_results programs program_members \
 *                 program_milestones program_checkins program_reports keuangan_pengajuan \
 *                 keuangan_transaksi; do
 *          mysql --batch -e "SELECT * FROM $t" asiania_my > ppidk/$t.tsv; done
 *   2. Download the finance PDFs (R2 keys in `dokumen`, `bukti_transfer` and `bukti`) into one
 *      folder, keeping their paths.
 *   3. node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *        --env-file=apps/admin/.env.local infrastructure/scripts/import-ppidk-programs.mjs \
 *        --dir ./ppidk [--files ./ppidk-r2] [--apply]
 *   4. Read the report (ppidk/import-programs-report.json): counts and every skipped row.
 *
 * Files: only real PDFs (checked by their first bytes) found under --files are referenced and
 * copied privately into FILE_STORAGE_DIR. Run it where FILE_STORAGE_DIR is (cPanel Terminal)
 * with --files.
 * Needs DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (and
 * FILE_STORAGE_DIR with --files).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseTsv } from "../../packages/db/src/ppidk/people.ts";
import { mapPpidkPrograms, PPIDK_PROGRAM_TABLES } from "../../packages/db/src/ppidk/programs.ts";
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
    "Usage: import-ppidk-programs.mjs --dir <folder with the .tsv files> [--files <PPIDK PDFs>] [--apply]",
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

const read = (name) => parseTsv(readFileSync(join(values.dir, `${name}.tsv`), "utf8"));
const tables = Object.fromEntries(PPIDK_PROGRAM_TABLES.map((name) => [name, read(name)]));
const users = read("users");

// Periods, units and accounts come from the people import: refuse to run before it.
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

const plan = mapPpidkPrograms(tables, { uidOf, file, now: new Date() });

const report = { dryRun: !values.apply, counts: plan.counts, skipped: plan.skipped };
writeFileSync(
  join(values.dir, "import-programs-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({ ...report, skipped: plan.skipped.length }, null, 2));
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
