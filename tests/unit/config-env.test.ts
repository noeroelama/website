import { describe, expect, it } from "vitest";
import {
  APP_ENVIRONMENTS,
  assertEnvironmentIsolation,
  EnvironmentIsolationError,
  FIREBASE_EMULATOR_VARIABLES,
} from "@website/config";
import { baseEnv, EnvValidationError, firebaseAdminEnv, loadEnv } from "@website/config/env";

const schema = baseEnv.extend(firebaseAdminEnv.shape);

describe("environment validation", () => {
  it("rejects missing and blank required variables without echoing values", () => {
    expect(() => loadEnv(schema, { APP_ENV: "development", FIREBASE_PROJECT_ID: "  " })).toThrow(
      EnvValidationError,
    );
  });

  it("uses ONE Firebase project for every environment", () => {
    for (const appEnv of ["development", "test", "staging", "production"]) {
      expect(
        loadEnv(schema, { APP_ENV: appEnv, FIREBASE_PROJECT_ID: "ppidk-website-prod" })
          .FIREBASE_PROJECT_ID,
      ).toBe("ppidk-website-prod");
    }
  });

  it("deployed environments refuse any other project", () => {
    for (const appEnv of ["staging", "production"]) {
      expect(() =>
        loadEnv(schema, { APP_ENV: appEnv, FIREBASE_PROJECT_ID: "someone-elses-project" }),
      ).toThrow(EnvironmentIsolationError);
    }
  });

  it("refuses Firebase emulator variables in every environment (emulators are not used)", () => {
    for (const appEnv of APP_ENVIRONMENTS) {
      for (const variable of FIREBASE_EMULATOR_VARIABLES) {
        expect(() =>
          loadEnv(schema, {
            APP_ENV: appEnv,
            FIREBASE_PROJECT_ID: "ppidk-website-prod",
            [variable]: "127.0.0.1:8080",
          }),
        ).toThrow(EnvironmentIsolationError);
        expect(() =>
          assertEnvironmentIsolation({
            appEnv,
            firebaseProjectId: "ppidk-website-prod",
            env: { [variable]: "127.0.0.1:8080" },
          }),
        ).toThrow(EnvironmentIsolationError);
      }
    }
  });

  it("refuses emulator variables even when no Firebase project is configured", () => {
    expect(() =>
      loadEnv(baseEnv, { APP_ENV: "development", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }),
    ).toThrow(EnvironmentIsolationError);
  });

  it("ignores emulator variables that are present but blank", () => {
    expect(() =>
      assertEnvironmentIsolation({
        appEnv: "production",
        firebaseProjectId: "ppidk-website-prod",
        env: { FIRESTORE_EMULATOR_HOST: "  " },
      }),
    ).not.toThrow();
  });
});
