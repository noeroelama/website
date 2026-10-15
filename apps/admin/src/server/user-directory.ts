import "server-only";
import { lazyEnv } from "@website/config/env";
import type { UserDirectory } from "@website/db";
import { createFirestoreUserStore } from "@website/db/firestore";
import { adminDb } from "./stores";

/**
 * Maps a verified Firebase uid to the account's status and role assignments (`users/{uid}` + the
 * custom roles in `roles/{id}`, one read each). A valid Firebase login alone grants nothing in
 * admin: no record, an inactive account or no staff role keeps the admin area closed.
 */
export const userDirectory = lazyEnv((): UserDirectory => createFirestoreUserStore(adminDb()));
