# Vercel projects

One Vercel project per deployable, all pointing at this repository:

| Vercel project          | Root directory | Domain              | Template              |
| ----------------------- | -------------- | ------------------- | --------------------- |
| `ppidk-website-web`     | `apps/web`     | `web.example.org`   | `web.vercel.json`     |
| `ppidk-website-admin`   | `apps/admin`   | `admin.example.org` | `admin.vercel.json`   |
| `ppidk-website-shop`    | `apps/shop`    | `shop.example.org`  | `shop.vercel.json`    |
| `ppidk-website-gateway` | `apps/gateway` | `api.example.org`   | `gateway.vercel.json` |

Copy a template to `apps/<app>/vercel.json` when creating the project (kept here so the
apps stay deployment-agnostic until then). `turbo-ignore` skips a deployment when nothing
that app depends on changed, so a broken `shop` can never block a `web` hotfix.

Per project:

1. **Git**: Production Branch = `prod`. Create a custom environment **Staging** tracking the
   `staging` branch. Everything else (`dev`, PR branches) is a Preview.
2. **Environment variables**: every environment uses the one Firebase project
   `ppidk-website-prod`. Preview and Staging set `APP_ENV=staging`, Production `APP_ENV=production`;
   the Firebase values are the same in all three.
3. Mark secrets as **Sensitive**. Every project needs its own `RATE_LIMIT_SECRET` (≥ 32 random characters) per environment.
4. Enable **Deployment Protection** for Preview deployments (preview URLs are otherwise public).
5. Set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`.
6. Node.js version: 24.x.

See `docs/deployment.md`.
