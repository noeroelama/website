import { type z } from "zod";
import {
  assertEnvironmentIsolation,
  FIREBASE_EMULATOR_VARIABLES,
  type AppEnvironment,
} from "../environments";

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function loadEnv<
  S extends z.ZodObject<z.ZodRawShape & { APP_ENV: z.ZodType<AppEnvironment> }>,
>(schema: S, source: EnvSource): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const env = result.data as Record<string, unknown>;
  const appEnv = env["APP_ENV"] as AppEnvironment;
  const projectId = (env["FIREBASE_PROJECT_ID"] ?? env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"]) as
    string | undefined;
  const emulatorVariableSet = FIREBASE_EMULATOR_VARIABLES.some((name) => name in cleaned);
  if (projectId !== undefined || emulatorVariableSet) {
    assertEnvironmentIsolation({ appEnv, firebaseProjectId: projectId, env: cleaned });
  }

  return result.data;
}

export function lazyEnv<T>(load: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= load());
}
