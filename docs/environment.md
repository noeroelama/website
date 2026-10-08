# Environments

| `APP_ENV`     | Where                                  | Firebase project                             |
| ------------- | -------------------------------------- | -------------------------------------------- |
| `development` | Your machine                           | `ppidk-website-prod` or emulators (`demo-*`) |
| `test`        | CI, Playwright                         | None (in-memory adapters)                    |
| `staging`     | `dev`/`staging` branches + PR previews | `ppidk-website-prod`                         |
| `production`  | `prod` branch (Vercel Production)      | `ppidk-website-prod`                         |

`APP_ENV` is ours; `NODE_ENV` is "production" for every optimized build and must not be used
to tell staging from production.

## One Firebase project

Decision (2026-10): there is **one** Firebase project — one Firestore database, one Auth user pool,
one Storage bucket — for every environment. `APP_ENV` still separates behaviour (logging, rate-limit
secret, emulators), but **`dev` and `staging` deployments read and write the live data**: test on
copies of content (drafts), never on real subscribers or members.

Enforced in code (`packages/config/src/environments.ts → assertEnvironmentIsolation`), called by
every env loader and every Firebase adapter:

- `staging` and `production` **throw** unless `FIREBASE_PROJECT_ID` is `WEBSITE_FIREBASE_PROJECT_ID`.
- Emulator hosts are rejected in `staging`/`production`.

To move to another project ID, change `WEBSITE_FIREBASE_PROJECT_ID` and
`infrastructure/firebase/.firebaserc` together (tests cover the guard).

## Variables

Each app validates only the fragments it needs (`packages/config/src/env/schemas.ts`), lazily at
first use — never at import or build time — and errors list variable names, never values.

| File                        | Variables                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.example`     | APP_ENV, LOG_LEVEL, FIREBASE__, NEXT_PUBLIC_FIREBASE__, SESSION_MAX_AGE_HOURS, WEB_URL (passkeys), RECAPTCHA_*, RATE_LIMIT_SECRET |
| `apps/admin/.env.example`   | APP_ENV, FIREBASE__, NEXT_PUBLIC_FIREBASE__, SESSION_MAX_AGE_HOURS, RESEND__, EMAIL_FROM__, ZOOM_*, CALENDAR_FEED_SIGNING_SECRET  |
| `apps/shop/.env.example`    | APP_ENV, FIREBASE__, NEXT_PUBLIC_FIREBASE__, PAYMENT__, RESEND__                                                                  |
| `apps/gateway/.env.example` | APP_ENV, PORT, API_KEY_PEPPER, GATEWAY__, FIREBASE__                                                                              |

`.env.example` files must contain placeholders only; `pnpm check:secrets` fails otherwise.

## Where each value comes from

Locally: copy `apps/<app>/.env.example` to `apps/<app>/.env.local` (git-ignored). Deployed: Vercel →
project → Settings → Environment Variables (mark secrets **Sensitive**).

| Variable                                                          | Value                                                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`                                             | `ppidk-website-prod`                                                                                                                                             |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`                   | Firebase console → Project settings → Service accounts → Generate new private key; copy `client_email` and `private_key` (keep the `\n`). Never commit the JSON. |
| `FIREBASE_STORAGE_BUCKET`                                         | Firebase console → Storage, e.g. `ppidk-website-prod.firebasestorage.app` (no `gs://`)                                                                           |
| `NEXT_PUBLIC_FIREBASE_*`                                          | Firebase console → Project settings → Your apps → Web app config (`apiKey`, `authDomain`, `projectId`, `appId`)                                                  |
| `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`          | Empty. Only for local emulators (`127.0.0.1:9099`, `127.0.0.1:8080`); rejected when deployed.                                                                    |
| `WEB_URL`                                                         | Public site URL (web app; passkeys are bound to it): `http://localhost:3000` locally, the real domain when deployed (`https://…`, no trailing slash)             |
| `RESEND_API_KEY`                                                  | Not used yet (Firebase sends the password-reset emails). Later: resend.com → Domains (verify the sending domain) → API Keys → Create                             |
| `EMAIL_FROM_NEWSLETTER`, `EMAIL_FROM_TRANSACTIONAL`               | Not used yet. Later: a sender on the verified domain, e.g. `PPIDK Asia-Oseania <noreply@mail.example.org>`                                                       |
| `RATE_LIMIT_SECRET`, `API_KEY_PEPPER`                             | Random: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. The pepper must be identical in every environment (one database).      |
| `RESEND_WEBHOOK_SECRET`, `ZOOM_*`, `CALENDAR_FEED_SIGNING_SECRET` | Leave empty: the features that use them are not built yet.                                                                                                       |
