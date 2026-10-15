import "server-only";
import { createFirebaseAccountAdmin } from "@website/auth/firebase-admin";
import { lazyEnv } from "@website/config/env";
import {
  createFirestoreAccountStore,
  createFirestorePasskeyStore,
  createFirestoreRoleStore,
  getFirestoreForRole,
} from "@website/db/firestore";
import { createLogger } from "@website/observability";
import { getAdminEnv } from "./env";

/** Admin's Firestore client (role `admin_rw`, pooled) and Firebase Auth account operations. */
export const adminDb = lazyEnv(() => {
  const env = getAdminEnv();
  return getFirestoreForRole({
    appEnv: env.APP_ENV,
    role: "admin_rw",
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  });
});

export const adminStores = lazyEnv(() => {
  const env = getAdminEnv();
  const db = adminDb();
  return {
    accounts: createFirestoreAccountStore(db),
    roles: createFirestoreRoleStore(db),
    passkeys: createFirestorePasskeyStore(db),
    authAdmin: createFirebaseAccountAdmin({
      appEnv: env.APP_ENV,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    logger: createLogger({ service: "admin", level: env.LOG_LEVEL }),
  };
});
