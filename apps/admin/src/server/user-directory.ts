import "server-only";
import { lazyEnv } from "@website/config/env";
import type { UserDirectory } from "@website/db";
import { createFirestoreUserStore, getFirestoreForRole } from "@website/db/firestore";
import { getAdminEnv } from "./env";

/**
 * Maps a verified Firebase uid to the account's status and role assignments (`users/{uid}` + the
 * custom roles in `roles/{id}`, one read each). A valid Firebase login alone grants nothing in
 * admin: no record, an inactive account or no staff role keeps the admin area closed.
 */
export const userDirectory = lazyEnv((): UserDirectory => {
  const env = getAdminEnv();
  return createFirestoreUserStore(
    getFirestoreForRole({
      appEnv: env.APP_ENV,
      role: "admin_rw",
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
  );
});
