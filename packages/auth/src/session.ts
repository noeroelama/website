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
  identity: VerifiedIdentity,
  nowSeconds: number,
  maxAgeSeconds = 15 * 60,
): boolean {
  return nowSeconds - identity.authTime <= maxAgeSeconds;
}
