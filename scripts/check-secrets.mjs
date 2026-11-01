#!/usr/bin/env node
/**
 * Fails if anything that would be committed looks like a secret.
 * Scans tracked + untracked-but-not-ignored files (i.e. what `git add -A` would stage).
 * This is a safety net, not a replacement for GitHub secret scanning / push protection.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (/** @type {string[]} */ args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const files = git(["ls-files", "--cached", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean);
const problems = [];

const FORBIDDEN_NAMES = [
  /^\.env$/,
  /^\.env\.(?!example$).+/,
  /\.pem$/,
  /\.p12$/,
  /\.key$/,
  /service-?account.*\.json$/i,
  /firebase-adminsdk.*\.json$/i,
  /^credentials\.json$/,
];

/** @type {Array<[RegExp, string]>} */
const CONTENT_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?!\\n\.\.\.)/, "private key"],
  [/"type"\s*:\s*"service_account"/, "Google service account JSON"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\bre_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}\b/, "Resend API key"],
  [/\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/, "live payment secret key"],
  [/\bxnd_(?:production|development)_[0-9A-Za-z]{20,}\b/, "Xendit secret key"],
  [/\bpk_live_[a-z0-9]{12}_[A-Za-z0-9_-]{43}\b/, "live gateway API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
];

/** In .env.example files only these keys may have values (non-secret defaults). */
const EXAMPLE_ALLOWED_VALUES = new Set([
  "APP_ENV",
  "LOG_LEVEL",
  "PORT",
  "SESSION_MAX_AGE_HOURS",
  "RECAPTCHA_MIN_SCORE",
  "GATEWAY_RATE_LIMIT_PER_MINUTE",
  "GATEWAY_DB_MAX_CONNECTIONS",
  "DATABASE_CONNECTION_LIMIT",
]);

for (const file of files) {
  const name = basename(file);
  if (FORBIDDEN_NAMES.some((re) => re.test(name)))
    problems.push(`${file}: filename indicates a secret/credential file`);
  let content;
  try {
    if (statSync(join(ROOT, file)).size > 2_000_000) continue;
    content = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  if (file === "scripts/check-secrets.mjs") continue;
  for (const [re, label] of CONTENT_PATTERNS) {
    if (re.test(content)) problems.push(`${file}: looks like it contains a ${label}`);
  }
  if (name === ".env.example") {
    for (const line of content.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[2] !== "" && !EXAMPLE_ALLOWED_VALUES.has(m[1] ?? "")) {
        problems.push(`${file}: ${m[1]} must be empty in .env.example (placeholders only)`);
      }
    }
  }
}

// .gitignore must actually ignore the dangerous paths.
const mustBeIgnored = [
  ".env",
  ".env.local",
  "apps/admin/.env.local",
  "apps/gateway/.env.production",
  "service-account.json",
  "infrastructure/firebase/ppidk-firebase-adminsdk-abc12.json",
  "key.pem",
];
for (const path of mustBeIgnored) {
  try {
    git(["check-ignore", "-q", "--no-index", path]);
  } catch {
    problems.push(`.gitignore does not ignore ${path}`);
  }
}

if (problems.length) {
  console.error(`✖ Secret scan failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ Secret scan OK (${files.length} files checked, .gitignore rules verified).`);
