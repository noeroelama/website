import "server-only";
import { lazyEnv } from "@website/config/env";
import { webStorage } from "./db";
import { getWebEnv } from "./env";
import { createFileRoutes } from "./files";

/** `/files/…` and `/private-files` with the website's files folder and LINK_SIGNING_SECRET. */
export const fileRoutes = lazyEnv(() =>
  createFileRoutes({
    storage: webStorage,
    secret: () => getWebEnv().LINK_SIGNING_SECRET,
    now: () => new Date(),
  }),
);
