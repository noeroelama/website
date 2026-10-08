# Security

## Baseline (verified by tooling)

| Control                                                             | Enforcement                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in git                                                   | `.gitignore` + `pnpm check:secrets` (CI); enable GitHub push protection too                                                                                                                               |
| `.env.example` placeholders only                                    | `check:secrets`                                                                                                                                                                                           |
| Deployments use only the website project, never emulators           | `assertEnvironmentIsolation` (`environment.md`). One project for all environments: dev/staging work on live data                                                                                          |
| No browser access to Firestore/Storage                              | Deny-all `firestore.rules` / `storage.rules`; lint bans `firebase/firestore` etc. in apps                                                                                                                 |
| Admin SDK never in browser code                                     | Firebase imports allowed only in two server adapters; adapters throw if bundled for the browser; app code reaches them only from `src/server/**` (`import "server-only"`)                                 |
| Server-side authN/Z for admin                                       | `getPrincipal()` per request + `createGuardedAction` (tests: `admin-guarded-action.test.ts`)                                                                                                              |
| Gateway isolated from staff auth                                    | Lint + boundary check (gateway cannot import `@website/auth`, `permissions`, `audit`, `ui`)                                                                                                               |
| Health endpoints leak nothing                                       | `{ "status": "ok" }` only (tests)                                                                                                                                                                         |
| Security headers                                                    | `next.config.ts` per app; `secureHeaders()` in gateway                                                                                                                                                    |
| Per-IP rate limit (100/min, 10k/day, then 500 ms delay per request) | `@website/security` guard on every request in every app; shared Firestore counters (tests: `tests/security/rate-limit*`, `request-guard`, `gateway`)                                                      |
| Internal APIs only from our own site                                | Origin / `Sec-Fetch-Site` check on `/api/*` and every non-GET request (tests: `request-guard`, `e2e/security.spec.ts`)                                                                                    |
| HTTPS only                                                          | HSTS headers (Next config, gateway `secureHeaders`), `Secure` + `__Host-` cookies, Vercel HTTPS redirect (tests: `e2e/security.spec.ts`)                                                                  |
| OAuth sign-in                                                       | Google via Firebase → `POST /api/session` → HttpOnly session cookie; uid only from the verified token (tests: `session.test.ts`)                                                                          |
| Passkeys                                                            | WebAuthn with user verification, origin/RP-ID check, single-use server-side challenges, atomic signature counter (tests: `passkeys.test.ts`, `passkey-store.test.ts` — real ES256 software authenticator) |
| No account enumeration                                              | Same message for unknown email / wrong password; reset form always shows the same confirmation (tests: `auth-errors.test.ts`)                                                                             |
| Users locked to their own uid                                       | `*_own` permissions require `ownerId === principal.userId` (tests: `ownership.test.ts`)                                                                                                                   |
| Injection                                                           | Every input through strict Zod schemas; `safeText` for text, `safeId` for document ids (tests: `validation.test.ts`, members, gateway)                                                                    |
| No information exposure in errors                                   | Generic `{ error, message }` / RFC 9457 bodies; details only in logs (tests: `errors.test.ts`, `gateway.test.ts`)                                                                                         |
| Private responses never cached                                      | `Cache-Control: private, no-store` on API/account/admin/gateway responses (tests: `request-guard`, `gateway`)                                                                                             |
| Security test suite                                                 | `pnpm test:security`; `pnpm test` fails below 100% coverage of security code                                                                                                                              |
| Install scripts                                                     | Denied by default; explicit `allowBuilds` in `pnpm-workspace.yaml`                                                                                                                                        |
| Fresh-release hijacks                                               | `minimumReleaseAge: 1440` (24 h)                                                                                                                                                                          |

## Threat model summary

| Threat                     | Mitigation                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account takeover (staff)   | Google sign-in, MFA, short `__Host-` session cookies, `verifySessionCookie(…, checkRevoked)`, re-auth for sensitive actions                                  |
| Authorization bypass       | Never rely on `proxy.ts`/middleware for authZ; every action re-checks; deny by default                                                                       |
| Privilege escalation       | `canAssignRole`: only `users.manage`, and never a role with permissions you lack                                                                             |
| Stolen tokens              | HttpOnly cookies per subdomain, revocation, fresh-sign-in requirement on session creation                                                                    |
| Service account compromise | Per-role service accounts, WIF instead of keys, backups in a separate project                                                                                |
| Malicious uploads          | Signed uploads, magic-byte checks, size/pixel limits, re-encode, reject SVG (next phase)                                                                     |
| XSS                        | Sanitize rich text on write and render; nonce CSP via `proxy.ts` (next phase)                                                                                |
| CSRF                       | Server Actions check Origin; cookie-auth route handlers check Origin + SameSite                                                                              |
| SSRF                       | No server-side fetch of user URLs without an allowlist/IP check                                                                                              |
| Rate limiting / bots       | Per-IP limit on every request (100/min, 10k/day, then 500 ms delay per request) + per-key limit in the gateway; public forms add reCAPTCHA and double opt-in |
| Replay / duplicate writes  | `Idempotency-Key` required on gateway writes; webhook event-ID dedupe                                                                                        |
| Webhook forgery            | Signature + timestamp verification, dedupe, re-fetch state from provider                                                                                     |
| Audit tampering            | No mutation API; append-only store permissions; hash chain; off-project export                                                                               |
| API key leakage            | Only HMAC(secret, pepper) stored; shown once; per-key scopes/expiry/revocation; env-specific prefixes                                                        |

## Reporting

Security issues: contact the website maintainers privately; do not open public issues.
