import "server-only";
import { createPasskeyRoutes } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import { createFirestorePasskeyStore, getFirestoreForRole } from "@website/db/firestore";
import { getWebEnv } from "./env";
import { identity } from "./session";

/** Passkeys are bound to WEB_URL's hostname; credentials are stored in Firestore. */
export const passkeyRoutes = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.WEB_URL) throw new Error("WEB_URL is required for passkeys.");
  return createPasskeyRoutes({
    store: createFirestorePasskeyStore(
      getFirestoreForRole({
        appEnv: env.APP_ENV,
        role: "web_ro",
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
    ),
    identity: identity(),
    rpName: "PPIDK Asia-Oseania",
    origin: env.WEB_URL,
  });
});
