import "server-only";
import { createPasskeyRoutes, type SignInMethods } from "@website/auth";
import { createFirebaseAccountAdmin } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import { createSqlPasskeyStore, getDatabaseForRole } from "@website/db/sql";
import { getWebEnv } from "./env";
import { identity } from "./session";

const passkeyStore = lazyEnv(() => {
  const env = getWebEnv();
  return createSqlPasskeyStore(
    getDatabaseForRole({
      role: "web_ro",
      url: env.DATABASE_URL,
      connectionLimit: env.DATABASE_CONNECTION_LIMIT,
    }),
  );
});

export const passkeyRoutes = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.WEB_URL) throw new Error("WEB_URL is required for passkeys.");
  return createPasskeyRoutes({
    store: passkeyStore(),
    identity: identity(),
    rpName: "PPIDK Asia-Oseania",
    origin: env.WEB_URL,
  });
});

const accountAdmin = lazyEnv(() => {
  const env = getWebEnv();
  return createFirebaseAccountAdmin({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  });
});

export async function ownSignInMethods(uid: string): Promise<SignInMethods> {
  const [methods, passkeys] = await Promise.all([
    accountAdmin().signInMethods(uid),
    passkeyStore().listByUser(uid),
  ]);
  return { ...methods, passkeys: passkeys.length };
}
