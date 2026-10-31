import "server-only";
import { cookies } from "next/headers";
import {
  createSessionRoutes,
  hasTwoSignInMethods,
  SESSION_COOKIE,
  type VerifiedIdentity,
} from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import { createSqlUserStore, getDatabaseForRole } from "@website/db/sql";
import { createLogger, logSecurityEvent } from "@website/observability";
import { getWebEnv } from "./env";
import { ownSignInMethods } from "./passkeys";

export const identity = lazyEnv(() => {
  const env = getWebEnv();
  return createFirebaseIdentityProvider({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  });
});

export const logger = lazyEnv(() => createLogger({ service: "web", level: getWebEnv().LOG_LEVEL }));

/** Sign-in records (`users/{uid}`): web only ever writes the signed-in user's own record. */
const users = lazyEnv(() => {
  const env = getWebEnv();
  return createSqlUserStore(
    getDatabaseForRole({
      role: "web_ro",
      url: env.DATABASE_URL,
      connectionLimit: env.DATABASE_CONNECTION_LIMIT,
    }),
  );
});

export const sessionRoutes = lazyEnv(() =>
  createSessionRoutes({
    identity: identity(),
    maxAgeHours: getWebEnv().SESSION_MAX_AGE_HOURS,
    cookieDomain: getWebEnv().SESSION_COOKIE_DOMAIN,
    // Every sign-in method ends here: creates users/{uid} on the first one, then lastSignInAt.
    // A pending invite (admin Role Manager) applies here; its staff roles only once the account
    // has two sign-in methods (asked only for such an invite).
    onSignIn: async (signedIn) => {
      const { roleIds } = await users().recordSignIn(signedIn, new Date(), async () =>
        hasTwoSignInMethods(await ownSignInMethods(signedIn.uid)),
      );
      // Staff sign-ins are security events (DEC-16); Role Manager shows "last sign-in".
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
