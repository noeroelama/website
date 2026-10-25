import "server-only";
import { lazyEnv } from "@website/config/env";
import { createFirestoreVerificationReader } from "@website/db/firestore";
import { webDb, webStorage } from "./db";
import { createVerification } from "./verification";

/** /verify/<code> (D7): letters by verification code, archived PDFs from private Storage. */
export const verification = lazyEnv(() =>
  createVerification({
    reader: createFirestoreVerificationReader(webDb()),
    readFile: (path) => webStorage().read(path),
  }),
);
