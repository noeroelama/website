import { getApps, initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence, type Auth } from "firebase/auth";
import { firebaseClientEnv } from "@website/config/env";

let auth: Promise<Auth> | undefined;

export function clientAuth(): Promise<Auth> {
  auth ??= (async () => {
    const env = firebaseClientEnv.parse({
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env["NEXT_PUBLIC_FIREBASE_API_KEY"],
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env["NEXT_PUBLIC_FIREBASE_APP_ID"],
    });
    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
    const instance = getAuth(app);
    await setPersistence(instance, inMemoryPersistence);
    return instance;
  })();
  return auth;
}
