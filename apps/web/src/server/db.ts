import "server-only";
import { lazyEnv } from "@website/config/env";
import { getFirestoreForRole } from "@website/db/firestore";
import { getWebEnv } from "./env";

/** The website's Firestore client (role web_ro, pooled). */
export const webDb = lazyEnv(() => {
  const env = getWebEnv();
  return getFirestoreForRole({
    appEnv: env.APP_ENV,
    role: "web_ro",
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  });
});
