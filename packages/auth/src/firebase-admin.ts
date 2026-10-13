/**
 * Firebase Admin adapter for IdentityProvider. SERVER ONLY.
 * Apps must import this exclusively from their `src/server/**` modules (lint-enforced).
 */
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  applicationDefault,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { assertEnvironmentIsolation, type AppEnvironment } from "@website/config";
import type { IdentityProvider, VerifiedIdentity } from "./session";

if ("window" in globalThis) {
  throw new Error("@website/auth/firebase-admin must never be bundled into browser code.");
}

export interface FirebaseAdminConfig {
  readonly appEnv: AppEnvironment;
  readonly projectId: string;
  readonly clientEmail?: string | undefined;
  readonly privateKey?: string | undefined;
}

const APP_NAME = "website-auth";

function adminApp(config: FirebaseAdminConfig): App {
  assertEnvironmentIsolation({
    appEnv: config.appEnv,
    firebaseProjectId: config.projectId,
    env: process.env,
  });
  if (getApps().some((a) => a.name === APP_NAME)) return getApp(APP_NAME);
  // Prefer Workload Identity Federation / ADC; JSON key fields are a fallback.
  const credential =
    config.clientEmail && config.privateKey
      ? cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey.replace(/\\n/g, "\n"),
        })
      : applicationDefault();
  return initializeApp({ credential, projectId: config.projectId }, APP_NAME);
}

export function createFirebaseIdentityProvider(config: FirebaseAdminConfig): IdentityProvider {
  const auth = () => getAuth(adminApp(config));
  return {
    async createSessionCookie(idToken, maxAgeMs) {
      // Reject tokens that are not from a fresh sign-in (mitigates replay of old tokens).
      const decoded = await auth().verifyIdToken(idToken, true);
      if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
        throw new Error("Recent sign-in required");
      }
      return auth().createSessionCookie(idToken, { expiresIn: maxAgeMs });
    },
    async verifySessionCookie(cookie): Promise<VerifiedIdentity | null> {
      try {
        const decoded = await auth().verifySessionCookie(cookie, true);
        return {
          uid: decoded.uid,
          email: decoded.email ?? null,
          name: typeof decoded["name"] === "string" ? (decoded["name"] as string) : null,
          emailVerified: decoded.email_verified ?? false,
          signInProvider: decoded.firebase.sign_in_provider ?? null,
          authTime: decoded.auth_time,
        };
      } catch {
        return null;
      }
    },
    async revokeSessions(uid) {
      await auth().revokeRefreshTokens(uid);
    },
    createCustomToken(uid) {
      // Needs a service-account key (or the "Service Account Token Creator" role with ADC).
      return auth().createCustomToken(uid);
    },
  };
}
