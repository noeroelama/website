/**
 * Session cookie policy. ONE Firebase Auth user pool for everyone (staff, members, customers)
 * and ONE session shared by web, admin and shop (decision DEC-13): sign in once, signed in
 * everywhere; sign out anywhere revokes the session everywhere.
 *
 * `__Secure-` (not `__Host-`, which forbids a Domain): the cookie is always Secure + HttpOnly +
 * SameSite=Lax and is set on the parent domain from SESSION_COOKIE_DOMAIN (e.g. ppiasiania.id),
 * so it is sent to every subdomain — never to the gateway, which does not read it. Without a
 * domain (local development) it is host-only; localhost apps still share it across ports.
 * What an account may do in each app is still decided by RBAC on every request.
 */
export const SESSION_COOKIE = "__Secure-session";

/** Verified identity. Says WHO someone is — never what they may do (that is RBAC, from Firestore). */
export interface VerifiedIdentity {
  readonly uid: string;
  readonly email: string | null;
  /** Display name from the sign-in provider (Google sets it; email/password accounts may not). */
  readonly name?: string | null;
  readonly emailVerified: boolean;
  readonly signInProvider: string | null;
  /** Seconds since epoch of the last real sign-in; used for re-auth on sensitive actions. */
  readonly authTime: number;
}

/**
 * Identity provider port. Firebase today; the rest of the website depends only on this.
 */
export interface IdentityProvider {
  /** Exchanges a fresh ID token (from the client SDK) for a server session cookie. */
  createSessionCookie(idToken: string, maxAgeMs: number): Promise<string>;
  /** Verifies the cookie AND checks revocation. Returns null when invalid/revoked. */
  verifySessionCookie(cookie: string): Promise<VerifiedIdentity | null>;
  revokeSessions(uid: string): Promise<void>;
  /** Short-lived token the browser exchanges for a Firebase sign-in (used after a passkey login). */
  createCustomToken(uid: string): Promise<string>;
}

/** Sensitive actions (role changes, exports, refunds) require a recent sign-in. */
export function isRecentSignIn(
  identity: Pick<VerifiedIdentity, "authTime">,
  nowSeconds: number,
  maxAgeSeconds = 15 * 60,
): boolean {
  return nowSeconds - identity.authTime <= maxAgeSeconds;
}

/** How an account can sign in (Firebase Auth record + our passkeys). */
export interface SignInMethods {
  /** Firebase provider ids, e.g. "google.com", "password". */
  readonly providers: readonly string[];
  /** Enrolled multi-factor authentication factors. */
  readonly mfaFactors: number;
  readonly passkeys: number;
}

/**
 * Staff need a second way to prove who they are before a staff role is written (PPIDK rule
 * "two sign-in methods"): an enrolled MFA factor, or a passkey plus another sign-in method.
 */
export function hasTwoSignInMethods(methods: SignInMethods): boolean {
  return methods.mfaFactors > 0 || (methods.passkeys > 0 && methods.providers.length > 0);
}

/** Firebase Auth account operations used by the admin Users page and the web account page. */
export interface AccountAdmin {
  /** Provider ids and MFA factor count (passkeys are counted from our own store). */
  signInMethods(uid: string): Promise<Pick<SignInMethods, "providers" | "mfaFactors">>;
  /** Disabled accounts cannot sign in or refresh tokens. */
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeSessions(uid: string): Promise<void>;
}
