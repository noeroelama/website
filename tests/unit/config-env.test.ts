import { describe, expect, it } from "vitest";
import { EnvironmentIsolationError } from "@website/config";
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

  it("deployed environments refuse any other project and the emulators", () => {
    for (const appEnv of ["staging", "production"]) {
      expect(() =>
        loadEnv(schema, { APP_ENV: appEnv, FIREBASE_PROJECT_ID: "someone-elses-project" }),
      ).toThrow(EnvironmentIsolationError);
      expect(() =>
        loadEnv(schema, {
          APP_ENV: appEnv,
          FIREBASE_PROJECT_ID: "ppidk-website-prod",
          FIRESTORE_EMULATOR_HOST: "localhost:8080",
        }),
      ).toThrow(EnvironmentIsolationError);
    }
  });

  it("lets development use the local emulators (demo-* projects)", () => {
    expect(
      loadEnv(schema, {
        APP_ENV: "development",
        FIREBASE_PROJECT_ID: "demo-website",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      }).FIREBASE_PROJECT_ID,
    ).toBe("demo-website");
  });
});
