import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { canAccessAdmin, type Principal } from "@website/permissions";
import { getAdminEnv } from "./env";
import { denyAllUserDirectory, type UserDirectory } from "./user-directory";

const userDirectory: UserDirectory = denyAllUserDirectory;

/**
 * Resolves the current principal on the server for every request:
 * session cookie → Firebase verification (with revocation check) → user record + roles in Firestore.
 * Returns null unless the user holds a staff role (`admin.access`).
 * Never trusts client state, token claims, URL params or payload role fields.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  const env = getAdminEnv();
  const identity = await createFirebaseIdentityProvider({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  }).verifySessionCookie(cookie);
  if (!identity) return null;

  const principal = await userDirectory.findPrincipalByUid(identity.uid);
  return canAccessAdmin(principal) ? principal : null;
}
