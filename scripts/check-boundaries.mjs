#!/usr/bin/env node
/**
 * Architecture boundary check (runs in `pnpm lint` and CI).
 *
 * 1. Every workspace dependency edge must be in ALLOWED.
 * 2. Every `@website/*` import in source must be (a) declared in that workspace's
 *    package.json and (b) allowed — no phantom dependencies.
 * 3. No relative import may escape its workspace (e.g. ../../apps/admin/...).
 * 4. Subpath rules (e.g. shop may only use @website/domain/shop).
 * 5. The workspace dependency graph must be acyclic.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Approved dependency matrix. Changing this is an architecture decision (update docs/architecture.md).
 * @type {Record<string, string[]>}
 */
const ALLOWED = {
  // apps
  web: [
    "auth",
    "config",
    "contracts",
    "db",
    "domain",
    "email",
    "observability",
    "permissions",
    "security",
    "ui",
  ],
  admin: [
    "audit",
    "auth",
    "config",
    "db",
    "domain",
    "email",
    "observability",
    "permissions",
    "security",
    "ui",
  ],
  shop: [
    "auth",
    "config",
    "db",
    "domain",
    "email",
    "observability",
    "permissions",
    "security",
    "ui",
  ],
  gateway: ["apikeys", "config", "contracts", "db", "domain", "observability", "security"],
  // packages
  config: [],
  security: [],
  contracts: ["security"],
  domain: ["security"],
  permissions: [],
  audit: [],
  apikeys: [],
  email: [],
  observability: [],
  ui: [],
  auth: ["config", "security"],
  db: ["apikeys", "audit", "auth", "config", "domain", "permissions", "security"],
};

/** Subpath restrictions: workspace → package → allowed subpaths. @type {Record<string, Record<string, string[]>>} */
const SUBPATHS = {
  shop: { domain: ["shop", "shared"] },
  // messaging: confirmation e-mails sent by the website (event registration, newsletter opt-in).
  web: {
    domain: ["content", "events", "organizations", "newsletter", "members", "messaging", "shared"],
  },
  // Personal data (domain/members) never leaves through the third-party API.
  gateway: { domain: ["content", "events", "organizations", "shared"] },
  // The innermost layers may only use the framework-free sanitization helpers.
  domain: { security: ["validation"] },
  contracts: { security: ["validation"] },
};

/** Packages an app may never depend on, with the reason. @type {Record<string, Record<string, string>>} */
const FORBIDDEN_REASON = {
  gateway: {
    auth: "gateway must not import staff auth/session",
    permissions: "gateway must not import admin authorization internals",
    ui: "gateway has no UI",
    audit: "gateway must not import admin audit internals",
  },
};

const errors = [];
const workspaces = [];
for (const group of ["apps", "packages"]) {
  for (const name of readdirSync(join(ROOT, group))) {
    const dir = join(ROOT, group, name);
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      workspaces.push({ group, name, dir, pkg });
    } catch {
      /* not a workspace */
    }
  }
}

const shortName = (/** @type {string} */ pkgName) => pkgName.replace(/^@website\//, "");
const isInternal = (/** @type {string} */ name) =>
  name.startsWith("@website/") || ["web", "admin", "shop", "gateway"].includes(name);

// 1. package.json edges
/** @type {Map<string, string[]>} */
const graph = new Map();
for (const ws of workspaces) {
  const key = ws.name;
  if (!(key in ALLOWED))
    errors.push(`${ws.group}/${key}: not in the ALLOWED matrix (add it deliberately).`);
  const deps = Object.keys({
    ...ws.pkg.dependencies,
    ...ws.pkg.devDependencies,
    ...ws.pkg.peerDependencies,
  }).filter(isInternal);
  graph.set(key, deps.map(shortName));
  for (const dep of deps) {
    const target = shortName(dep);
    if (["web", "admin", "shop", "gateway"].includes(target)) {
      errors.push(`${ws.group}/${key} → ${target}: apps must never depend on apps.`);
    } else if (!(ALLOWED[key] ?? []).includes(target)) {
      const reason = FORBIDDEN_REASON[key]?.[target] ?? "edge not in ALLOWED matrix";
      errors.push(`${ws.group}/${key} → @website/${target}: ${reason}.`);
    }
  }
}

// 2–4. source imports
const IMPORT_RE =
  /(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;
const walk = (/** @type {string} */ dir) => {
  /** @type {string[]} */ const out = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", ".turbo"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
};

for (const ws of workspaces) {
  const declared = new Set(
    Object.keys({ ...ws.pkg.dependencies, ...ws.pkg.devDependencies, ...ws.pkg.peerDependencies }),
  );
  for (const file of walk(ws.dir)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (!(target + sep).startsWith(ws.dir + sep) && target !== ws.dir) {
          errors.push(
            `${rel}: relative import "${spec}" escapes its workspace — depend on the package instead.`,
          );
        }
        continue;
      }
      if (!spec.startsWith("@website/")) continue;
      const [, pkgShort, ...rest] = spec.split("/");
      const pkgName = `@website/${pkgShort}`;
      if (!declared.has(pkgName))
        errors.push(`${rel}: imports ${spec} but ${pkgName} is not declared in package.json.`);
      if (!(ALLOWED[ws.name] ?? []).includes(pkgShort ?? ""))
        errors.push(`${rel}: ${ws.name} may not import ${pkgName}.`);
      const allowedSubpaths = SUBPATHS[ws.name]?.[pkgShort ?? ""];
      if (allowedSubpaths && !allowedSubpaths.includes(rest[0] ?? "")) {
        errors.push(
          `${rel}: ${ws.name} may only import ${pkgName}/{${allowedSubpaths.join(",")}}, not "${spec}".`,
        );
      }
    }
  }
}

// 5. cycles
const visiting = new Set();
const done = new Set();
const visit = (/** @type {string} */ node, /** @type {string[]} */ path) => {
  if (done.has(node)) return;
  if (visiting.has(node)) {
    errors.push(`dependency cycle: ${[...path, node].join(" → ")}`);
    return;
  }
  visiting.add(node);
  for (const dep of graph.get(node) ?? []) visit(dep, [...path, node]);
  visiting.delete(node);
  done.add(node);
};
for (const node of graph.keys()) visit(node, []);

if (process.argv.includes("--graph")) {
  for (const [node, deps] of [...graph.entries()].sort())
    console.log(`${node.padEnd(14)} → ${deps.sort().join(", ") || "(none)"}`);
}

if (errors.length > 0) {
  console.error(`✖ Architecture boundary violations (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Architecture boundaries OK (${workspaces.length} workspaces checked).`);
