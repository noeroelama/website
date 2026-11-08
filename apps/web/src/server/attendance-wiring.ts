import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlMeetingStore } from "@website/db/sql";
import { createAttend } from "./attendance";
import { webDb } from "./db";

export const attend = lazyEnv(() =>
  createAttend({ meetings: createSqlMeetingStore(webDb()), now: () => new Date() }),
);
