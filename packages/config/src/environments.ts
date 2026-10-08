/**
 * Deployment environments and the hard boundary between them.
 *
 * `APP_ENV` is our own variable. Do not use NODE_ENV for this: NODE_ENV is
 * "production" for every optimized build, including staging.
 */
export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * The ONE Firebase/GCP project (Auth + Firestore + Storage) used by every environment.
 * Keep in sync with infrastructure/firebase/.firebaserc.
 */
export const WEBSITE_FIREBASE_PROJECT_ID = "ppidk-website-prod";

export class EnvironmentIsolationError extends Error {
  override readonly name = "EnvironmentIsolationError";
}

/**
 * Deployed environments (staging, production) must use the website's Firebase project and never
 * the local emulators. Development/test may also use emulators with a `demo-*` project.
 * Called by every env loader and every Firebase adapter.
 */
export function assertEnvironmentIsolation(input: {
  appEnv: AppEnvironment;
  firebaseProjectId: string | undefined;
  emulatorHost: string | undefined;
}): void {
  const { appEnv, firebaseProjectId, emulatorHost } = input;
  if (appEnv !== "staging" && appEnv !== "production") return;
  if (firebaseProjectId !== WEBSITE_FIREBASE_PROJECT_ID) {
    throw new EnvironmentIsolationError(
      `APP_ENV=${appEnv} must use the website Firebase project (${WEBSITE_FIREBASE_PROJECT_ID}).`,
    );
  }
  if (emulatorHost) {
    throw new EnvironmentIsolationError(
      `Firebase emulators are only allowed in development/test (APP_ENV=${appEnv}).`,
    );
  }
}
