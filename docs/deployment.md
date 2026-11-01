# Deployment

## Boundaries

All four apps run on **DomaiNesia cPanel** (Setup Node.js App = CloudLinux + Passenger), one
Node.js app per deployable, each with its own (sub)domain, environment variables, Firebase service
account and restart. There are no preview deployments.

| App     | Domain             | Built where                                | Runs             |
| ------- | ------------------ | ------------------------------------------ | ---------------- |
| web     | main domain        | GitHub Actions (`NEXT_OUTPUT=standalone`)  | `server.js`      |
| admin   | `admin.` subdomain | GitHub Actions (`NEXT_OUTPUT=standalone`)  | `server.js`      |
| shop    | `shop.` subdomain  | GitHub Actions (`NEXT_OUTPUT=standalone`)  | `server.js`      |
| gateway | `api.` subdomain   | on the server (cPanel Git Version Control) | `dist/server.js` |

Shared hosts often have a glibc older than the Next.js compiler needs (the build fails with
`GLIBC_2.29 not found`), so web, admin and shop are built in GitHub Actions and uploaded; only the
gateway (plain Node, tsup) is built on the server.

What Passenger means for the code:

- Passenger may stop an idle app and may run **more than one process**. Nothing that must be
  shared lives in memory (rate-limit counters are in MySQL); small per-process caches are fine.
- No background workers or timers: work without a visitor runs through [cron jobs](#scheduled-jobs-cpanel-cron-jobs).
- `"use cache"` entries live in one process, so `revalidateTag()` clears only the process that ran
  it. Public lists use `cacheLife("minutes")` at most; revalidation is a speed-up, not the guarantee.
- Restart = touch `tmp/restart.txt` in the app root (`scripts/deploy-cpanel.sh` does it).

## Branches and flow

There are exactly three branches. **Do not create other branches** (no feature/fix branches).

| Branch    | Purpose                               | Deploys to                                | Firebase project     |
| --------- | ------------------------------------- | ----------------------------------------- | -------------------- |
| `dev`     | All day-to-day work is committed here | nothing (check locally: `pnpm dev`, e2e)  | `ppidk-website-prod` |
| `staging` | Release candidate, tested by the team | optional `staging.*` apps (same workflow) | `ppidk-website-prod` |
| `prod`    | What is live (default branch)         | cPanel production apps                    | `ppidk-website-prod` |

```text
commit + push to dev ─PR─▶ staging ─PR─▶ prod ─▶ GitHub Actions (web, admin, shop) + cPanel Git (gateway)
CI runs on every push and PR: format, lint+boundaries, typecheck, test, build, secrets, e2e
```

- Run `pnpm verify` before every push to `dev`; CI re-checks it.
- `staging` and `prod` change only through a PR from the branch before them
  (`dev → staging`, `staging → prod`). Never push directly to them.
- Urgent fix: commit it to `dev`, then promote with the same two PRs.
- GitHub protection: `staging` and `prod` require a PR + the **CI** check (plus ≥ 1 approval on
  `prod`); all three block force pushes and deletion.
- Dependency updates are done by hand (no Dependabot version-update branches).
- Every environment uses the live Firebase project: test with drafts and your own account, and keep
  `MESSAGING_MODE=log` outside production.

## One-time setup

Needs: **Setup Node.js App** offering Node 22.12 or newer, and a host that accepts SSH logins from
GitHub's servers. Check the Node path with `ls /opt/alt` in cPanel Terminal and fix the `PATH` in
`.cpanel.yml` if it differs.

1. **SSH Access** → generate a key with **no passphrase** → Authorize. Add its public key to
   GitHub → repository → Settings → Deploy keys (read-only). The server uses it to pull.
2. In cPanel Terminal run `ssh -T git@github.com` and answer `yes`.
3. **Git Version Control** → Create: clone URL `git@github.com:ppidk-asiania/website.git`,
   path `/home/<user>/repositories/2026`, then check out `prod`.
4. Create a **second** key in **SSH Access** (no passphrase) and Authorize it. GitHub uses it to
   log in and upload. In GitHub → repository → Settings → Secrets and variables → Actions add:

| Name                 | Kind     | Value                                                |
| -------------------- | -------- | ---------------------------------------------------- |
| `CPANEL_SSH_KEY`     | Secret   | the private key of the second key                    |
| `CPANEL_HOST`        | Variable | `<cpanel user>@<server host name>`                   |
| `CPANEL_SSH_PORT`    | Variable | only if the host does not use port 22                |
| `CPANEL_KNOWN_HOSTS` | Variable | output of `ssh-keyscan -p <port> <server host name>` |

Also add these five as **Variables** (public values, not secret): `NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` and
`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`. The browser bundles are built with them.

5. Deploy once (see "Every release") so the app folders exist.
6. **Setup Node.js App** → Create one app per row (Node 22+, mode Production). Paths are relative
   to your home folder. Do **not** click "Run NPM Install".

| App     | Application root                 | Startup file     | URL                |
| ------- | -------------------------------- | ---------------- | ------------------ |
| web     | `apps/web/apps/web`              | `server.js`      | main domain        |
| admin   | `apps/admin/apps/admin`          | `server.js`      | `admin.` subdomain |
| shop    | `apps/shop/apps/shop`            | `server.js`      | `shop.` subdomain  |
| gateway | `repositories/2026/apps/gateway` | `dist/server.js` | `api.` subdomain   |

7. Add each app's variables from its `.env.example` in the app's screen (see
   [environment.md](environment.md)): `APP_ENV=production`, real `https://` URLs, the same
   `SESSION_COOKIE_DOMAIN` for web, admin and shop. Never put them in the repository.

8. **SSL/TLS Status** → run AutoSSL for the main domain and the `admin.`, `shop.` and `api.`
   subdomains (webhooks and cron calls need a valid certificate on `admin.`).

9. **MySQL Databases** (once): create one database (e.g. `<cpanel>_ppidk`) and one user per app
   (`<cpanel>_web`, `<cpanel>_admin`, `<cpanel>_shop`), each added to the database with ALL
   PRIVILEGES (tables are created on first use). Their URLs go into `DATABASE_URL` of each app
   (`mysql://<user>:<password>@localhost:3306/<database>`). Keep the passwords in the password manager.
10. **Files folder** (once, cPanel Terminal): `mkdir -p ~/ppidk-files && chmod 700 ~/ppidk-files`, then
    set `FILE_STORAGE_DIR=/home/<cpanel>/ppidk-files` on web AND admin. Never put it inside an app
    folder: deploys replace those.
11. **Cron Jobs**: add the `expire` job (once a day) next to the others (`apps/admin/docs/cron.md`),
    and the nightly backup lines from [disaster-recovery.md](disaster-recovery.md).
12. **Moving existing data off Firestore** (once, only if Firestore still holds data): in cPanel
    Terminal in `~/repositories/2026`, run `infrastructure/scripts/copy-firestore-to-mysql.mjs`
    (header of the script: dry run, read `copy-report.json`, then `--files --apply`) while nobody
    edits, then restart web and admin. Spot-check news, a member profile and an uploaded image.

## Every release

Merge to `prod` (PR from `staging`, as above).

- web, admin, shop deploy by themselves: watch **Actions → Deploy cPanel**. To redeploy without a
  new commit, use **Run workflow** on `prod`.
- gateway: **Git Version Control** → Manage → Pull or Deploy → **Update from Remote** →
  **Deploy HEAD Commit**. Never edit files in the server copy: cPanel refuses to deploy a
  repository with uncommitted changes.

Behind Passenger, `request.url` is the internal address (`http://localhost:<port>`), so the
origin check in `packages/security/src/request-guard.ts` compares the `Origin` header with the
`Host`/`X-Forwarded-Host` header instead. A 403 on `/api/session` after sign-in means that check failed.

## Rollback

- **Code**: revert the change on `dev`, promote it to `prod` through the usual PRs; the workflow
  redeploys web, admin and shop, then deploy the gateway again (Git Version Control → Deploy HEAD
  Commit). For an emergency, **Run workflow** on an older `prod` commit redeploys web, admin and shop.
- **Data**: changes are expand/contract — add new fields/collections first, ship code that handles
  both shapes, remove the old shape in a later release. Never ship a destructive data change in
  the same deploy as the code that needs it. Take a backup/PITR note before every migration.

## Scheduled jobs (cPanel Cron Jobs)

Read-time rules come first (offer expiry, scheduled news visibility, overdue deadlines need no
schedule). Work that must happen without a visitor (reminders, retries, newsletter sends) is a job
in admin at `GET /cron/<job>`, called by **cPanel → Cron Jobs**, one line per job:

```bash
curl -fsS --max-time 50 -H "Authorization: Bearer $(cat ~/.config/ppidk/cron-secret)" https://admin.<domain>/cron/<job> >/dev/null
```

- The secret file holds `CRON_SECRET`; create it once with `mkdir -p ~/.config/ppidk`, write the
  value, then `chmod 600 ~/.config/ppidk/cron-secret`. Never put the secret in the repository or in
  the crontab line itself.
- Each job is idempotent, handles one bounded batch per call (target < 30 s) and returns a JSON
  summary; the next call continues. The job list and their crontab lines are in
  `apps/admin/docs/cron.md` (call `noop` once after set-up to check the secret and the route).
- The shortest interval the hosting plan allows is in [Limits](#limits).

## Logs

Apps write structured JSON lines (`@website/observability`) to stdout/stderr. Passenger stores them
in `stderr.log` in each app root (cPanel → File Manager, or `tail -f` in Terminal). There is no log
drain and no database log viewer yet (DEC-9). Never log secrets or personal data; the logger
redacts known keys.

## Monitoring

web and admin answer `GET /health`, the gateway `GET /health` and `GET /v1/health`, all with
`{"status":"ok"}` and no database call. Uptime checks for all four hosts are listed in
`infrastructure/monitoring/checks.example.json`.

## Limits

Filled in by the owner from the DomaiNesia plan (step 0.3). Steps that stream big files, render
big PDFs or send in batches must stay inside them.

| Limit                                 | Value                                                                |
| ------------------------------------- | -------------------------------------------------------------------- |
| Memory per account / per process      | 3 GB per account (Hosting 3.0 Monster, 2026-10-31)                   |
| CPU                                   | 100% (one core)                                                      |
| Entry processes (concurrent requests) | 20                                                                   |
| Number of processes                   | 200                                                                  |
| Maximum request time                  | _tbd_                                                                |
| Shortest cron interval                | _tbd_                                                                |
| Node.js versions offered (`/opt/alt`) | _tbd_                                                                |
| glibc version (`ldd --version`)       | _tbd_                                                                |
| Passenger processes per app           | _tbd_                                                                |
| MySQL                                 | 8.0.46; databases 7.94 GB of the 12 GB disk; I/O 150 MB/s, 6000 IOPS |

## Migrations

Collections are MySQL tables with a JSON `data` column, created on first use from
`packages/db/src/sql/collections.ts`, so a new collection needs no migration. Data changes use
versioned scripts in `infrastructure/scripts/` (`--dry-run` first) plus a `schemaVersion` field and
tolerant readers. Take a `mysqldump` before every data change.

## Feature flags

Start with a server-side flags module/config document. Adopt a flag service only when
percentage rollouts are needed.

## Secrets

- Runtime values live in each app's **Setup Node.js App** screen; `NEXT_PUBLIC_*` values (public,
  baked into browser bundles) are GitHub Actions **Variables**. Everything secret is also kept in
  the password manager.
- Each app uses its own MySQL user (`DATABASE_URL`) and its own Firebase service account
  (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, Authentication only) with the narrowest IAM role
  it needs. Rotate passwords and keys on schedule and when anyone leaves.
- Every new variable: schema fragment (`packages/config/src/env/schemas.ts`) + `.env.example`
  placeholder + a row in [environment.md](environment.md).

## Environment set-up (owner checklist)

One-time console work. Tick each item here when it is done; never write secret values in this
file (they live in the cPanel app screens and the password manager).

- [ ] DomaiNesia: fill in [Limits](#limits) from the hosting plan.
- [ ] On the host: `ldd --version`, `ls /opt/alt`; after the first deploy that ships image uploads,
      `node -e "require('sharp')"` in the admin app root (if it fails, install the WebAssembly build of sharp:
      `packages/db/docs/files.md` → Configuration).
- [ ] Firebase Authentication: **multi-factor authentication** enabled (Identity Platform upgrade) —
      staff roles require a second sign-in method.
- [ ] MySQL database + one user per app, `FILE_STORAGE_DIR` folder, cron `expire` (One-time setup
      steps 9–11).
- [ ] Nightly `mysqldump` + files backup and a weekly off-server copy
      ([disaster-recovery.md](disaster-recovery.md)).
- [ ] Existing Firestore data and Storage files copied once (One-time setup step 12).
- [ ] One Firebase service account per app (web, admin, shop) for Authentication only; keys only in
      that app's Setup Node.js App screen and the password manager.
- [ ] Generate `CRON_SECRET`, `FIELD_ENCRYPTION_KEY` and `SIGNED_LINK_SECRET` and store them in the
      password manager; they are added to the app screens when the step that uses them is built.
- [ ] Decide the main domain name and whether to run a `staging.*` set of apps (DEC-17); then
      DNS + AutoSSL for the main domain, `admin.`, `shop.` and `api.` (later `verif.ppiasiania.id`).
- [ ] First superadmin granted (`infrastructure/scripts/grant-superadmin.mjs`, see
      `packages/auth/docs/authentication.md` → Account lifecycle).
- [ ] People and the organisation imported from PPIDK once (block J): freeze the PPIDK people
      screens, export the tables as TSV, set "Roles from appointments", then
      `infrastructure/scripts/import-ppidk-people.mjs --dir <folder>` (dry run, read
      `import-report.json`, then `--apply`; see `packages/domain/docs/members.md` → Import from
      PPIDK). Spot-check 10 people; re-grant the manual roles the report lists.
- [ ] Forms and recruitment imported from PPIDK after the people import: freeze those PPIDK
      screens, export the tables as TSV, run
      `infrastructure/scripts/import-ppidk-recruitment.mjs --dir <folder> --files <storage>`
      (dry run, read `import-recruitment-report.json`, then `--apply`; see
      `packages/domain/docs/recruitment.md` → Import from PPIDK).
- [ ] Before the first letter is issued: add `verif.ppiasiania.id` as an extra domain of the web
      app (cPanel → Domains + AutoSSL, DNS record), set `VERIFICATION_HOST` to it on web AND admin.
- [ ] Personal signatures: generate `FIELD_ENCRYPTION_KEY` once (`docs/environment.md`), set the
      SAME value on web AND admin, keep a copy offline (losing it loses every stored signature).
- [ ] Universities imported once the PPI chapters are active
      (`infrastructure/scripts/import-ror-universities.mjs`, dry run first; see
      `packages/domain/docs/members.md` → Universities). Run again when chapters are added.
