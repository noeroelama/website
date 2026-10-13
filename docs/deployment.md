# Deployment

## Boundaries

Four Vercel projects from one repository (see `infrastructure/vercel/README.md`). Each has its
own domain, environment variables, service account and rollback. `turbo-ignore` skips builds for
apps whose dependency graph did not change. To host on cPanel instead, see [cPanel](#cpanel).

## Branches and flow

There are exactly three branches. **Do not create other branches** (no feature/fix branches).

| Branch    | Purpose                               | Deploys to                          | Firebase project     |
| --------- | ------------------------------------- | ----------------------------------- | -------------------- |
| `dev`     | All day-to-day work is committed here | Vercel Preview (dev branch)         | `ppidk-website-prod` |
| `staging` | Release candidate, tested by the team | Vercel Staging (custom environment) | `ppidk-website-prod` |
| `prod`    | What is live (default branch)         | Vercel Production                   | `ppidk-website-prod` |

```text
commit + push to dev ─PR─▶ staging ─PR─▶ prod
CI runs on every push and PR: format, lint+boundaries, typecheck, test, build, secrets, e2e
```

- Run `pnpm verify` before every push to `dev`; CI re-checks it.
- `staging` and `prod` change only through a PR from the branch before them
  (`dev → staging`, `staging → prod`). Never push directly to them.
- Urgent fix: commit it to `dev`, then promote with the same two PRs.
- GitHub protection: `staging` and `prod` require a PR + the **CI** check (plus ≥ 1 approval on
  `prod`); all three block force pushes and deletion.
- Dependency updates are done by hand (no Dependabot version-update branches).

## Rollback

- **Code**: Vercel instant rollback per app.
- **Data**: changes are expand/contract — add new fields/collections first, ship code that handles
  both shapes, remove the old shape in a later release. Never ship a destructive data change in
  the same deploy as the code that needs it. Take a backup/PITR note before every migration.

## Migrations

Firestore has no schema migrations: use versioned scripts (`infrastructure/` in a later phase)
plus a `schemaVersion` field and tolerant readers.

## Feature flags

Start with a server-side flags module/config document. Adopt a flag service only when
percentage rollouts are needed.

## Secrets

Vercel environment variables (Sensitive), separate per environment. Prefer Vercel OIDC →
GCP Workload Identity Federation over JSON keys. Rotate on schedule and when anyone leaves.

## Environment set-up (owner checklist)

One-time console work before the organisation-management features are built. Tick each item
here when it is done; never write secret values in this file (they live in Vercel and the
password manager).

- [ ] Vercel **Pro** plan for the admin project (minute-level cron, DEC-4 in `architecture.md`).
- [ ] Firebase Authentication: **multi-factor authentication** enabled (needs the Identity
      Platform upgrade) — staff roles require MFA.
- [ ] Firebase Storage: default bucket exists; its name is in `FIREBASE_STORAGE_BUCKET`.
- [ ] Firestore: **point-in-time recovery**, **scheduled backups** and **delete protection**
      enabled (`disaster-recovery.md`).
- [ ] Per-app service accounts, or Vercel OIDC → GCP Workload Identity Federation, for web,
      admin, shop and gateway (see "Secrets" above).
- [ ] Generate `CRON_SECRET`, `FIELD_ENCRYPTION_KEY` and `SIGNED_LINK_SECRET` and store them in
      the password manager. They are added to Vercel when the step that uses them is built.

## cPanel

Alternative to Vercel for cPanel hosting (e.g. Domanesia). cPanel **Git Version Control** pulls
the `prod` branch; `.cpanel.yml` then runs `scripts/deploy-cpanel.sh`, which builds the apps,
copies each Next app to `~/apps/<app>` and restarts it. Setting `NEXT_OUTPUT=standalone` (only the
script sets it) makes web, admin and shop emit a self-contained `server.js`; without it nothing
changes for Vercel or `pnpm start`.

Needs: **Setup Node.js App** offering Node 22.12 or newer, about 2 GB of memory for the build, and
internet during the build (pnpm, Google Fonts). Check the Node path with `ls /opt/alt` in cPanel
Terminal and fix the `PATH` in `.cpanel.yml` if it differs.

One-time setup:

1. **SSH Access** → generate a key with **no passphrase** → Authorize. Add its public key to
   GitHub → repository → Settings → Deploy keys (read-only).
2. In cPanel Terminal run `ssh -T git@github.com` and answer `yes`.
3. **Git Version Control** → Create: clone URL `git@github.com:ppidk-asiania/website.git`,
   path `/home/<user>/repositories/website`, then check out `prod`.
4. Deploy once (see "Every release") so the app folders exist.
5. **Setup Node.js App** → Create one app per row (Node 22+, mode Production). Paths are relative
   to your home folder. Do **not** click "Run NPM Install".

| App     | Application root                    | Startup file     | URL                |
| ------- | ----------------------------------- | ---------------- | ------------------ |
| web     | `apps/web/apps/web`                 | `server.js`      | main domain        |
| admin   | `apps/admin/apps/admin`             | `server.js`      | `admin.` subdomain |
| shop    | `apps/shop/apps/shop`               | `server.js`      | `shop.` subdomain  |
| gateway | `repositories/website/apps/gateway` | `dist/server.js` | `api.` subdomain   |

6. Add each app's variables from its `.env.example` in the app's screen (see
   [environment.md](environment.md)): `APP_ENV=production`, real `https://` URLs, the same
   `SESSION_COOKIE_DOMAIN` for web, admin and shop. Never put them in the repository.

Every release: merge to `prod` (PR from `staging`, as above), then **Git Version Control** →
Manage → Pull or Deploy → **Update from Remote** → **Deploy HEAD Commit**. Never edit files in
the server copy: cPanel refuses to deploy a repository with uncommitted changes.

Rollback: revert the change on `prod` through a PR, then deploy again.

There are no Preview or Staging deployments on cPanel; test on `dev`/`staging` locally or on Vercel.
Scheduled jobs (DEC-4) use Vercel Cron; on cPanel they need **Cron Jobs** calling `/cron/<job>`.
