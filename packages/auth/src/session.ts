export const SESSION_COOKIE = "__Secure-session";

export interface VerifiedIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly name?: string | null;
  readonly picture?: string | null;
  readonly emailVerified: boolean;
  readonly signInProvider: string | null;
  readonly authTime: number;
}

export interface IdentityProvider {
  createSessionCookie(idToken: string, maxAgeMs: number): Promise<string>;
  verifySessionCookie(cookie: string): Promise<VerifiedIdentity | null>;
  revokeSessions(uid: string): Promise<void>;
  createCustomToken(uid: string): Promise<string>;
}

export function isRecentSignIn(
  identity: Pick<VerifiedIdentity, "authTime">,
  nowSeconds: number,
  maxAgeSeconds = 15 * 60,
): boolean {
  return nowSeconds - identity.authTime <= maxAgeSeconds;
}

export interface SignInMethods {
  readonly providers: readonly string[];
  readonly mfaFactors: number;
  readonly passkeys: number;
}

export function hasTwoSignInMethods(methods: SignInMethods): boolean {
  return methods.mfaFactors > 0 || (methods.passkeys > 0 && methods.providers.length > 0);
}

export interface AccountAdmin {
  signInMethods(uid: string): Promise<Pick<SignInMethods, "providers" | "mfaFactors">>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeSessions(uid: string): Promise<void>;
}
