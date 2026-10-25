import "server-only";
import { lazyEnv } from "@website/config/env";
import { appForRole, createFirebaseImageStorage, getFirestoreForRole } from "@website/db/firestore";
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

/**
 * Private Storage of the website (FIREBASE_STORAGE_BUCKET): recruitment portfolios and pacts
 * (written), archived letters (read for public verification). No public URLs.
 */
export const webStorage = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.FIREBASE_STORAGE_BUCKET) {
    throw new Error("FIREBASE_STORAGE_BUCKET is required for files on the website.");
  }
  return createFirebaseImageStorage(
    appForRole({
      appEnv: env.APP_ENV,
      role: "web_ro",
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    env.FIREBASE_STORAGE_BUCKET,
  );
});
