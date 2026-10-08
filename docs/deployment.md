# Deployment

## Boundaries

Four Vercel projects from one repository (see `infrastructure/vercel/README.md`). Each has its
own domain, environment variables, service account and rollback. `turbo-ignore` skips builds for
apps whose dependency graph did not change.

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
