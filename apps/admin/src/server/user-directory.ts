import "server-only";
import { lazyEnv } from "@website/config/env";
import type { UserDirectory } from "@website/db";
import { createSqlUserStore } from "@website/db/sql";
import { adminDb } from "./stores";

export const userDirectory = lazyEnv((): UserDirectory => createSqlUserStore(adminDb()));
