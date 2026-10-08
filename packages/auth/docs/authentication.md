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

1. Anyone may create an account. On first sign-in the server creates `users/{uid}` with
   the default role `user` (self-service only).
2. Completing the member profile + approval by a `chapter_admin`/`admin` adds `member`.
3. Staff roles are granted only by holders of `users.manage` (superadmin), never by sign-up.
   **There is no way to self-register into the admin area.**

## Sessions

```text
browser (Firebase client SDK) ─ ID token ─▶ POST /api/session on the SAME app (same-origin)
   server: verifyIdToken(checkRevoked) + require fresh sign-in (≤ 5 min)
         → createSessionCookie (8 h default, max 12)
         → Set-Cookie: __Host-session; HttpOnly; Secure; SameSite=Lax; Path=/
every request: cookie → verifySessionCookie(checkRevoked) → users/{uid} roles → Principal
```

- Same accounts everywhere, but **separate cookies per app** (`__Host-` = host-only):
  a session on `shop.` or `web.` is never sent to `admin.`.
- Admin additionally requires a staff role (`canAccessAdmin`); members get "not authorized".
- Endpoint (web, admin, shop): `POST /api/session` with `{ "idToken": "<Firebase ID token>" }` →
  `204` + cookie; invalid body `400`; invalid/expired token `401` (reason not disclosed).
  `DELETE /api/session` → revokes all sessions of the user and clears the cookie.
  Implemented once in `packages/auth/src/session-routes.ts`; each app's `src/app/api/session/route.ts` wires it.
- The body accepts only `idToken` — the uid always comes from the verified token.
- Sign-out and role changes revoke refresh tokens (`revokeSessions`).
- Sensitive actions require a recent sign-in (`isRecentSignIn`, ≤ 15 min).
- `proxy.ts` (middleware) is never relied on for authentication or authorization.
- Custom Claims are not used for authorization.
