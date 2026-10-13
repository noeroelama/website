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
 * Firebase emulators are not used (decision 2026-10-08). The Firebase SDKs read these variables
 * straight from the process environment, so setting one would silently redirect traffic.
 */
export const FIREBASE_EMULATOR_VARIABLES = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
] as const;

/**
 * Every environment refuses Firebase emulator variables; deployed environments (staging,
 * production) must also use the website's Firebase project.
 * Called by every env loader (with its source) and every Firebase adapter (with process.env).
 */
export function assertEnvironmentIsolation(input: {
  appEnv: AppEnvironment;
  firebaseProjectId: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): void {
  const { appEnv, firebaseProjectId, env } = input;
  const emulatorVariable = FIREBASE_EMULATOR_VARIABLES.find((name) => env[name]?.trim());
  if (emulatorVariable) {
    throw new EnvironmentIsolationError(
      `${emulatorVariable} is set, but Firebase emulators are not used. Remove it (APP_ENV=${appEnv}).`,
    );
  }
  if (appEnv !== "staging" && appEnv !== "production") return;
  if (firebaseProjectId !== WEBSITE_FIREBASE_PROJECT_ID) {
    throw new EnvironmentIsolationError(
      `APP_ENV=${appEnv} must use the website Firebase project (${WEBSITE_FIREBASE_PROJECT_ID}).`,
    );
  }
}
