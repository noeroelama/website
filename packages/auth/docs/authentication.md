# Authentication

**One Firebase Authentication user pool for everyone** — staff, members and shop customers —
in the one Firebase project (`ppidk-website-prod`) used by every environment. Firebase says _who_ someone
is; _what_ they may do comes only from RBAC role assignments in Firestore (`users/{uid}`).

## Sign-in methods

| Method           | Sign up                                                                     | Sign in                                                      | Where                 |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| Google           | `/signup` or `/login` → "Continue with Google" (same action)                | same                                                         | Firebase popup        |
| Email + password | `/signup` (8+ characters, confirmation; verification email sent)            | `/login`                                                     | Firebase              |
| Passkey          | Added from `/account` after signing in (needs a sign-in in the last 15 min) | `/login` → "Sign in with a passkey"                          | Our server (WebAuthn) |
| Forgot password  | —                                                                           | `/forgot-password` → Firebase reset email → back to `/login` | Firebase              |

- Email must be verified before a member profile can be saved.
- Staff accounts (any role with `admin.access`) must have MFA enabled before the role is granted.
- Pages live in `apps/web/src/app/{login,signup,forgot-password,account}`; browser logic in
  `apps/web/src/lib/auth-client.ts`. Firebase keeps nothing in the browser (in-memory persistence):
  after each sign-in the ID token is exchanged for the session cookie and the browser signs out of Firebase.
- Error messages never reveal whether an email has an account (`apps/web/src/lib/auth-errors.ts`);
  the reset form always shows the same confirmation.

## Passkeys

Firebase Auth has no passkey support, so the web server verifies WebAuthn itself
(`packages/auth/src/passkeys.ts`, library `@simplewebauthn/server`) and then hands Firebase a
custom token:

```text
add:     /account → POST /api/passkeys/register-options (session + recent sign-in)
         → browser creates passkey → POST /api/passkeys/register-verify → saved in passkeys/{hash}
sign in: POST /api/passkeys/login-options → browser signs → POST /api/passkeys/login-verify
         → { customToken } → signInWithCustomToken → POST /api/session (normal session cookie)
```

- Passkeys are bound to the hostname of `WEB_URL` and require user verification (biometric/PIN).
- Each challenge is stored server-side (`webauthnChallenges`), referenced by an HttpOnly
  `__Host-passkey-challenge` cookie, valid 5 minutes and **single-use** (atomic read-and-delete),
  so assertions cannot be replayed even by concurrent requests.
- The signature counter is updated atomically and must increase (0 → 0 allowed for synced
  passkeys); a lower value is treated as a cloned authenticator and refused.
- Failures always return the same `401` — the response never says why.

## Account lifecycle

1. Anyone may create an account. Every sign-in method ends in web `POST /api/session`; after the
   session cookie is created, `onSignIn` (from `createSessionRoutes`) reads the uid back from that
   verified cookie and `recordSignIn` creates `users/{uid}` with the default role `user`
   (self-service only) the first time, and updates `lastSignInAt` every time. If that write fails,
   the sign-in fails (no cookie).
2. Completing the member profile + approval by a `chapter_admin`/`admin` adds `member`.
3. Staff roles are granted only by holders of `users.edit` who hold every permission of that role (superadmin only by a superadmin), never by sign-up.
   **There is no way to self-register into the admin area.**
4. **Bootstrap** — the first superadmin: the person signs in on web once, then the owner runs
   `node --env-file=apps/admin/.env.local infrastructure/scripts/grant-superadmin.mjs --email <address>`
   (dry run), then again with `--apply`. Later superadmins are granted on the admin Users page.
5. Too many wrong passwords: Firebase Auth throttles the account itself (`auth/too-many-requests`,
   shown as "Too many attempts…"); `/api/session` also has the per-IP limit. There is no custom
   failed-login counter (the server never sees failed Firebase password attempts).

## Sessions

**One session for every app** (DEC-13): sign in once on the web app and you are signed in on
admin and shop too; signing out in any app signs you out of all of them.

```text
browser (Firebase client SDK) ─ ID token ─▶ POST /api/session (same-origin, any app)
   server: verifyIdToken(checkRevoked) + require fresh sign-in (≤ 5 min)
         → createSessionCookie (8 h default, max 12)
         → Set-Cookie: __Secure-session; Domain=<SESSION_COOKIE_DOMAIN>; HttpOnly; Secure; SameSite=Lax; Path=/
every request, every app: cookie → verifySessionCookie(checkRevoked) → users/{uid} roles → Principal
```

- The cookie is set on the parent domain (`SESSION_COOKIE_DOMAIN`, e.g. `ppiasiania.id`), so web,
  admin and shop all receive it. It stays HttpOnly (scripts cannot read it), Secure and
  SameSite=Lax. Without a domain (local development) it is host-only; `localhost` apps still share
  it because cookies ignore the port.
- Sharing the session does **not** share permissions: admin still requires a staff role
  (`canAccessAdmin`), staff need MFA, and sensitive actions need a recent sign-in.
- Sign-in happens on the web app. A signed-out visitor who opens a login-required page in any app
  is redirected (307) to `WEB_URL/login?next=<that page's URL>` (`signInUrl`). After signing in the
  web app returns there only if `safeReturnUrl` accepts the target (a relative path, or a URL on
  WEB_URL / ADMIN_URL / SHOP_URL — no open redirect). Admin needs `WEB_URL` and `ADMIN_URL` set for
  the redirect; without them it shows "sign-in required" instead.
- That redirect is sent by each app's `src/proxy.ts` (`signInRedirect` in
  `src/server/request-guard.ts`) when the session cookie is missing, before the page renders. With
  Cache Components a page's own `redirect()` is streamed (200 + client-side redirect), so the
  proxy is what makes it a real 307. The page still verifies the session and permissions.
- Endpoint (web, admin, shop): `POST /api/session` with `{ "idToken": "<Firebase ID token>" }` →
  `204` + cookie; invalid body `400`; invalid/expired token `401` (reason not disclosed).
  `DELETE /api/session` → revokes all sessions of the user and clears the cookie (same Domain).
  Implemented once in `packages/auth/src/session-routes.ts`; each app's `src/app/api/session/route.ts` wires it.
- Use the same `SESSION_MAX_AGE_HOURS` and `SESSION_COOKIE_DOMAIN` in web, admin and shop.
- The body accepts only `idToken` — the uid always comes from the verified token.
- Sign-out and role changes revoke refresh tokens (`revokeSessions`), which ends the session in
  every app.
- Sensitive actions require a recent sign-in (`isRecentSignIn`, ≤ 15 min).
- `proxy.ts` (middleware) is never relied on for authentication or authorization: it only checks
  that a session cookie exists (for the sign-in redirect); pages verify it.
- Custom Claims are not used for authorization.
- Keep DNS clean: every subdomain of `SESSION_COOKIE_DOMAIN` receives the cookie, so remove
  records that point to services we no longer control (subdomain takeover).
