import "server-only";
import { cookies } from "next/headers";
import { createSessionRoutes, SESSION_COOKIE, type VerifiedIdentity } from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import { createFirestoreUserStore, getFirestoreForRole } from "@website/db/firestore";
import { createLogger, logSecurityEvent } from "@website/observability";
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

const logger = lazyEnv(() => createLogger({ service: "web", level: getWebEnv().LOG_LEVEL }));

/** Sign-in records (`users/{uid}`): web only ever writes the signed-in user's own record. */
const users = lazyEnv(() => {
  const env = getWebEnv();
  return createFirestoreUserStore(
    getFirestoreForRole({
      appEnv: env.APP_ENV,
      role: "web_ro",
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
  );
});

export const sessionRoutes = lazyEnv(() =>
  createSessionRoutes({
    identity: identity(),
    maxAgeHours: getWebEnv().SESSION_MAX_AGE_HOURS,
    cookieDomain: getWebEnv().SESSION_COOKIE_DOMAIN,
    // Every sign-in method ends here: creates users/{uid} on the first one, then lastSignInAt.
    onSignIn: async (signedIn) => {
      const { roleIds } = await users().recordSignIn(signedIn, new Date());
      // Staff sign-ins are security events (DEC-16); the Users page shows "last sign-in".
      if (roleIds.some((id) => id !== "user" && id !== "member")) {
        logSecurityEvent(logger(), { type: "staff.login", actorId: signedIn.uid });
      }
    },
  }),
);

/** The signed-in user (verified session cookie, revocation checked), or null. */
export async function getSignedInUser(): Promise<VerifiedIdentity | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return cookie ? identity().verifySessionCookie(cookie) : null;
}
