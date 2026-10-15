/**
 * Firestore access is confined to this folder. No other package or app may import
 * `firebase-admin/firestore` (lint-enforced), so storage details stay out of
 * domain and UI code.
 */
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertEnvironmentIsolation, type AppEnvironment } from "@website/config";
import type { DatabaseRole } from "../roles";

export { createFirestoreRateLimitStore } from "./rate-limit";
export { createFirestoreAuditWriter, type FirestoreAuditWriter } from "./audit";
export { getDocumentsByIds } from "./batch";
export { createFirestorePasskeyStore } from "./passkeys";
export { createFirestoreRoleStore, createFirestoreUserStore } from "./users";

if ("window" in globalThis) {
  throw new Error("@website/db must never be bundled into browser code.");
}

export interface FirestoreConfig {
  readonly appEnv: AppEnvironment;
  readonly role: DatabaseRole;
  readonly projectId: string;
  /** Per-role service account (least privilege). Omit to use Workload Identity / ADC. */
  readonly clientEmail?: string | undefined;
  readonly privateKey?: string | undefined;
}

/**
 * Returns the Firestore client for a role. Connection pooling: the client is created once per
 * role per server process and reused for every request; it keeps a pool of gRPC channels open,
 * so requests never pay to connect/disconnect. Never create a client per request.
 */
export function getFirestoreForRole(config: FirestoreConfig): Firestore {
  assertEnvironmentIsolation({
    appEnv: config.appEnv,
    firebaseProjectId: config.projectId,
    env: process.env,
  });
  const name = `website-db-${config.role}`;
  const app: App = getApps().some((a) => a.name === name)
    ? getApp(name)
    : initializeApp(
        {
          projectId: config.projectId,
          credential:
            config.clientEmail && config.privateKey
              ? cert({
                  projectId: config.projectId,
                  clientEmail: config.clientEmail,
                  privateKey: config.privateKey.replace(/\\n/g, "\n"),
                })
              : applicationDefault(),
        },
        name,
      );
  return getFirestore(app);
}

// Further repository implementations (events, content, chapters, apiKeys) are added module by
// module. They implement the ports declared in @website/domain (or ../users.ts) and are exposed
// per role via ../roles.ts.
