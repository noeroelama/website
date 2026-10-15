# Environments

| `APP_ENV`     | Where                              | Firebase project          |
| ------------- | ---------------------------------- | ------------------------- |
| `development` | Your machine                       | `ppidk-website-prod`      |
| `test`        | CI, Playwright                     | None (in-memory adapters) |
| `staging`     | optional `staging.*` apps          | `ppidk-website-prod`      |
| `production`  | `prod` branch (cPanel, DomaiNesia) | `ppidk-website-prod`      |

`APP_ENV` is ours; `NODE_ENV` is "production" for every optimized build and must not be used
to tell staging from production.

## One Firebase project

Decision (2026-10): there is **one** Firebase project — one Firestore database, one Auth user pool,
one Storage bucket — for every environment. `APP_ENV` still separates behaviour (logging, rate-limit
secret), but **every deployment (and your machine) reads and writes the live data**: test on
copies of content (drafts), never on real subscribers or members.

Enforced in code (`packages/config/src/environments.ts → assertEnvironmentIsolation`), called by
every env loader and every Firebase adapter:

- `staging` and `production` **throw** unless `FIREBASE_PROJECT_ID` is `WEBSITE_FIREBASE_PROJECT_ID`.
- Every environment **throws** when a Firebase emulator variable is set (`FIREBASE_AUTH_EMULATOR_HOST`,
  `FIRESTORE_EMULATOR_HOST`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`): emulators are not used
  (2026-10-08), and the Firebase SDKs would read these straight from the process environment.
  Tests use in-memory adapters instead.

To move to another project ID, change `WEBSITE_FIREBASE_PROJECT_ID` and
`infrastructure/firebase/.firebaserc` together (tests cover the guard).

## Variables

Each app validates only the fragments it needs (`packages/config/src/env/schemas.ts`), lazily at
first use — never at import or build time — and errors list variable names, never values.

| File                        | Variables                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.example`     | APP_ENV, LOG_LEVEL, FIREBASE__, NEXT_PUBLIC_FIREBASE__, SESSION_MAX_AGE_HOURS, SESSION_COOKIE_DOMAIN, WEB_URL (passkeys), ADMIN_URL, SHOP_URL, RECAPTCHA_*, RATE_LIMIT_SECRET                                                                                                          |
| `apps/admin/.env.example`   | APP_ENV, FIREBASE__ (incl. FIREBASE_STORAGE_BUCKET), NEXT_PUBLIC_FIREBASE__, SESSION_MAX_AGE_HOURS, SESSION_COOKIE_DOMAIN, WEB_URL, ADMIN_URL, CRON_SECRET, MESSAGING_MODE, MESSAGING_TEST_RECIPIENTS, RESEND__, EMAIL_FROM__, ZOOM_*, CALENDAR_FEED_SIGNING_SECRET, RATE_LIMIT_SECRET |
| `apps/shop/.env.example`    | APP_ENV, FIREBASE__, NEXT_PUBLIC_FIREBASE__, SESSION_COOKIE_DOMAIN, PAYMENT__, RESEND__                                                                                                                                                                                                |
| `apps/gateway/.env.example` | APP_ENV, PORT, API_KEY_PEPPER, GATEWAY__, FIREBASE__                                                                                                                                                                                                                                   |

`.env.example` files must contain placeholders only; `pnpm check:secrets` fails otherwise.

## Where each value comes from

Locally: copy `apps/<app>/.env.example` to `apps/<app>/.env.local` (git-ignored). Deployed: cPanel →
**Setup Node.js App** → the app → Environment variables (runtime values), plus GitHub Actions
**Variables** for the `NEXT_PUBLIC_*` values that are baked into the browser bundles at build time
(see [deployment.md](deployment.md#one-time-setup)). Secrets also go into the password manager.

| Variable                                                          | Value                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`                                             | `ppidk-website-prod`                                                                                                                                                                                                                   |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`                   | Firebase console → Project settings → Service accounts → Generate new private key; copy `client_email` and `private_key` (keep the `\n`). Never commit the JSON.                                                                       |
| `FIREBASE_STORAGE_BUCKET`                                         | Firebase console → Storage, e.g. `ppidk-website-prod.firebasestorage.app` (no `gs://`)                                                                                                                                                 |
| `NEXT_PUBLIC_FIREBASE_*`                                          | Firebase console → Project settings → Your apps → Web app config (`apiKey`, `authDomain`, `projectId`, `appId`)                                                                                                                        |
| `WEB_URL`                                                         | Public site URL (web app; passkeys are bound to it): `http://localhost:3000` locally, the real domain when deployed (`https://…`, no trailing slash)                                                                                   |
| `SESSION_COOKIE_DOMAIN`                                           | web, admin, shop — the SAME value: the parent domain all three apps share, e.g. `ppiasiania.id` (no scheme, port or path). Empty locally (localhost shares cookies across ports).                                                      |
| `ADMIN_URL`, `SHOP_URL`                                           | web: other apps the sign-in page may return to (`/login?next=…`). admin: `WEB_URL` + `ADMIN_URL` build its "Sign in" link. `http://localhost:3001` etc. locally, `https://…` when deployed, no trailing slash.                         |
| `MESSAGING_MODE`, `MESSAGING_TEST_RECIPIENTS`                     | admin. `log` (default) records messages without sending — keep it everywhere except production. `live` sends; outside production only to the comma-separated test addresses (`apps/admin/docs/messaging.md`).                          |
| `RESEND_API_KEY`                                                  | admin messaging (`MESSAGING_MODE=live`); Firebase still sends the password-reset emails. Get it at resend.com → Domains (verify the sending domain) → API Keys → Create                                                                |
| `EMAIL_FROM_NEWSLETTER`, `EMAIL_FROM_TRANSACTIONAL`               | Not used yet. Later: a sender on the verified domain, e.g. `PPIDK Asia-Oseania <noreply@mail.example.org>`                                                                                                                             |
| `RATE_LIMIT_SECRET`, `API_KEY_PEPPER`                             | Random: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. The pepper must be identical in every environment (one database).                                                                            |
| `CRON_SECRET`                                                     | admin only. Random, ≥ 32 characters (same command as `RATE_LIMIT_SECRET`). The same value goes into `~/.config/ppidk/cron-secret` on the server for the crontab lines (`apps/admin/docs/cron.md`). Empty = every cron call is refused. |
| `RESEND_WEBHOOK_SECRET`, `ZOOM_*`, `CALENDAR_FEED_SIGNING_SECRET` | Leave empty: the features that use them are not built yet.                                                                                                                                                                             |
