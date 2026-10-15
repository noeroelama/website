#!/usr/bin/env node
/**
 * Bootstrap: gives the built-in `superadmin` role (global) to an existing account, found by e-mail.
 * Run once, locally, with the admin service account. Dry run unless --apply is given.
 *
 *   node --env-file=apps/admin/.env.local infrastructure/scripts/grant-superadmin.mjs --email you@example.org
 *   node --env-file=apps/admin/.env.local infrastructure/scripts/grant-superadmin.mjs --email you@example.org --apply
 *
 * The person must have signed in on web once (that creates users/{uid}). Later superadmins are
 * granted on the admin Users page. Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { email: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!values.email) {
  console.error("Usage: grant-superadmin.mjs --email <address> [--apply]");
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
const account = await getAuth(app).getUserByEmail(values.email);
const db = getFirestore(app);
const ref = db.collection("users").doc(account.uid);

const result = await db.runTransaction(async (tx) => {
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) return "no-record";
  const assignments = snapshot.get("roleAssignments") ?? [];
  if (assignments.some((a) => a.roleId === "superadmin" && a.scope?.type === "global")) {
    return "already";
  }
  if (values.apply) {
    tx.update(ref, {
      roleAssignments: [...assignments, { roleId: "superadmin", scope: { type: "global" } }],
    });
  }
  return values.apply ? "granted" : "would-grant";
});

const messages = {
  "no-record": "No users/{uid} record yet: sign in on the web app once, then run this again.",
  already: "Already a superadmin. Nothing changed.",
  "would-grant": "Dry run: would add superadmin (global). Re-run with --apply.",
  granted: "Granted superadmin (global). Sign out and in again to use admin.",
};
console.log(`${values.email} (${account.uid}): ${messages[result]}`);
if (result === "granted") console.log("Record this change in the team's change log.");
process.exit(result === "no-record" ? 1 : 0);
