#!/usr/bin/env node
/**
 * Fills the universities master (`universities/{rorKey}_{country}`) from the official ROR data
 * dump (CC0), for the countries of the ACTIVE PPI chapters (feature A3; PPIDK DECISIONS §7, §7b).
 * Run locally by the owner with the admin service account. Dry run unless --apply is given.
 *
 *   1. Download the latest dump from https://zenodo.org/communities/ror-data (zip) and unzip the
 *      *.json file (about 300 MB).
 *   2. node --experimental-strip-types --max-old-space-size=4096 \
 *        --import ./infrastructure/scripts/ts-register.mjs --env-file=apps/admin/.env.local \
 *        infrastructure/scripts/import-ror-universities.mjs --file ~/Downloads/v2-ror-data.json
 *   3. Same with --apply.
 *
 * Safe to run again: rows are keyed by ROR id + country; an existing row gets the ROR fields and
 * stays approved, a new row is created. Proposed (manual) campuses are never touched.
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { universityRowsFromRor } from "../../packages/domain/src/members/universities.ts";

const { values } = parseArgs({
  options: { file: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.file) {
  console.error("Usage: import-ror-universities.mjs --file <ror-dump.json> [--apply]");
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
const { getFirestore } = require("firebase-admin/firestore");

const db = getFirestore(
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  }),
);

const chapters = await db.collection("chapters").where("active", "==", true).get();
const countries = new Set(chapters.docs.map((doc) => doc.get("countryCode")));
if (countries.size === 0) {
  console.error("No active PPI chapters yet: add them on Organizations → PPI first.");
  process.exit(1);
}

console.log(`Reading ${values.file} for ${countries.size} countries...`);
const items = JSON.parse(readFileSync(values.file, "utf8"));
const rows = items.flatMap((item) => universityRowsFromRor(item, countries));
const perCountry = Object.entries(Object.groupBy(rows, (row) => row.countryCode))
  .map(([code, list]) => `${code} ${list.length}`)
  .sort();
console.log(
  `${items.length} organisations read, ${rows.length} campuses:\n${perCountry.join("\n")}`,
);

if (!values.apply) {
  console.log("Dry run: nothing written. Add --apply to write.");
  process.exit(0);
}

const now = new Date();
const docs = db.collection("universities");
let created = 0;
for (let i = 0; i < rows.length; i += 400) {
  const chunk = rows.slice(i, i + 400);
  const refs = chunk.map((row) => docs.doc(row.id));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  chunk.forEach(({ id: _id, ...row }, j) => {
    const fields = { ...row, source: "ror", status: "approved", updatedAt: now };
    if (existing[j].exists) {
      batch.update(refs[j], fields);
    } else {
      created++;
      batch.set(refs[j], {
        ...fields,
        submittedBy: null,
        mergedInto: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        version: 1,
        createdAt: now,
        deletedAt: null,
      });
    }
  });
  await batch.commit();
}
console.log(`Done: ${created} new, ${rows.length - created} updated.`);
