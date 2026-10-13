import "server-only";
import { cookies } from "next/headers";
import { createSessionRoutes, SESSION_COOKIE, type VerifiedIdentity } from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import { getWebEnv } from "./env";

export const identity = lazyEnv(() => {
  const env = getWebEnv();
  return createFirebaseIdentityProvider({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  });
});

export const sessionRoutes = lazyEnv(() =>
  createSessionRoutes({ identity: identity(), maxAgeHours: getWebEnv().SESSION_MAX_AGE_HOURS }),
);

/** The signed-in user (verified session cookie, revocation checked), or null. */
export async function getSignedInUser(): Promise<VerifiedIdentity | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return cookie ? identity().verifySessionCookie(cookie) : null;
}
