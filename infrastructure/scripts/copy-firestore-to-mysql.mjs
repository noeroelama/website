#!/usr/bin/env node
/**
 * One-time move off Firestore (2026-10-31: Firebase keeps only Authentication): copies every
 * collection in packages/db/src/sql/collections.ts from Firestore into MySQL and, with --files,
 * every file of the Storage bucket into FILE_STORAGE_DIR. Run it in cPanel Terminal from
 * ~/repositories/2026 (it needs Firestore, the MySQL database and the files folder), after the
 * apps have been switched to maintenance or while nobody edits. Dry run unless --apply is given;
 * safe to run again (same ids, files overwritten).
 *
 *   node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *     --env-file=<file with the variables below> infrastructure/scripts/copy-firestore-to-mysql.mjs \
 *     [--files] [--apply]
 *
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (a service account that
 * can still read Firestore and Storage), DATABASE_URL, WEB_URL (new public file URLs) and, with
 * --files, FIREBASE_STORAGE_BUCKET and FILE_STORAGE_DIR. Stored Firebase download URLs are
 * rewritten to `<WEB_URL>/files/<path>`. Writes copy-report.json in the current folder.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { COLLECTIONS } from "../../packages/db/src/sql/collections.ts";
import { createDiskFileStorage } from "../../packages/db/src/sql/storage.ts";
import { getDatabase } from "../../packages/db/src/sql/store.ts";

const { values } = parseArgs({
  options: {
    files: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});
const required = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "DATABASE_URL",
  "WEB_URL",
];
if (values.files) required.push("FIREBASE_STORAGE_BUCKET", "FILE_STORAGE_DIR");
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}

// firebase-admin is a dependency of @website/auth; resolve it from there.
const require = createRequire(new URL("../../packages/auth/package.json", import.meta.url));
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldPath, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const app = initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const firestore = getFirestore(app);
const db = getDatabase({ url: process.env.DATABASE_URL });
const webUrl = process.env.WEB_URL.replace(/\/$/, "");

/** `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=…` */
const STORAGE_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)\?.*$/;
const unsupported = [];

/** Firestore value → store value: Timestamps become Dates, Storage URLs become /files URLs. */
function convert(value, where) {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") {
    const match = STORAGE_URL.exec(value);
    return match ? `${webUrl}/files/${decodeURIComponent(match[1])}` : value;
  }
  if (Array.isArray(value)) return value.map((v, i) => convert(v, `${where}.${i}`));
  if (value !== null && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      unsupported.push(where); // GeoPoint, Bytes, DocumentReference: not used by this platform
      return null;
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convert(v, `${where}.${k}`)]),
    );
  }
  return value;
}

const report = { dryRun: !values.apply, collections: {}, otherCollections: [], files: null };

const known = new Set(COLLECTIONS);
report.otherCollections = (await firestore.listCollections())
  .map((c) => c.id)
  .filter((id) => !known.has(id));

for (const name of COLLECTIONS) {
  let last = null;
  let count = 0;
  for (;;) {
    let query = firestore.collection(name).orderBy(FieldPath.documentId()).limit(400);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    if (values.apply) {
      const batch = db.batch();
      for (const doc of page.docs) {
        batch.set(db.collection(name).doc(doc.id), convert(doc.data(), `${name}/${doc.id}`));
      }
      await batch.commit();
    } else {
      for (const doc of page.docs) convert(doc.data(), `${name}/${doc.id}`);
    }
    count += page.size;
    last = page.docs[page.docs.length - 1].id;
  }
  report.collections[name] = count;
  console.log(`${name}: ${count}`);
}

if (values.files) {
  const bucket = getStorage(app).bucket(process.env.FIREBASE_STORAGE_BUCKET);
  const storage = createDiskFileStorage({
    root: process.env.FILE_STORAGE_DIR,
    baseUrl: webUrl,
    secret: undefined,
  });
  const [files] = await bucket.getFiles();
  report.files = { public: 0, private: 0, skipped: [] };
  for (const file of files) {
    if (file.name.endsWith("/")) continue; // folder placeholder
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(file.name) || file.name.includes("..")) {
      report.files.skipped.push(file.name); // a name the disk storage refuses
      continue;
    }
    // Files with a download token were public (DEC-12); everything else stays private.
    const visibility = file.metadata.metadata?.firebaseStorageDownloadTokens ? "public" : "private";
    report.files[visibility]++;
    if (values.apply) {
      const [bytes] = await file.download();
      await storage.save(file.name, bytes, { visibility });
    }
  }
  console.log(`files: ${report.files.public} public, ${report.files.private} private`);
}

report.unsupportedValues = unsupported;
writeFileSync("copy-report.json", `${JSON.stringify(report, null, 2)}\n`);
if (report.otherCollections.length > 0) {
  console.warn(`Not copied (not in collections.ts): ${report.otherCollections.join(", ")}`);
}
if (unsupported.length > 0) console.warn(`${unsupported.length} unsupported values set to null.`);
console.log(values.apply ? "Done." : "Dry run: nothing written. Add --apply to write.");
await db.close();
