export const APP_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const WEBSITE_FIREBASE_PROJECT_ID = "ppidk-website-prod";

export class EnvironmentIsolationError extends Error {
  override readonly name = "EnvironmentIsolationError";
}

export const FIREBASE_EMULATOR_VARIABLES = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
] as const;

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
