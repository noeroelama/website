import type { ApiKeyStore } from "@website/apikeys";
import type { ContentReader, ContentWriter } from "@website/domain/content";
import type { EventReader } from "@website/domain/events";
import type { MemberProfileRepository } from "@website/domain/members";
import type { ChapterReader } from "@website/domain/organizations";
import type { RoleReader, SignInRecorder, UserDirectory } from "./users";

/**
 * Each deployable gets ONE role and only the repositories that role may use.
 * The type system stops `web` from ever obtaining a writer.
 *
 * All data lives in Firestore. Roles map to separate service accounts (see packages/db/docs/database.md);
 * because Firestore IAM is project-wide, the per-role repository surface below is what
 * actually limits each app.
 */
export type DatabaseRole = "web_ro" | "admin_rw" | "shop_rw" | "gateway_rw";

export interface WebRepositories {
  readonly content: ContentReader;
  readonly events: EventReader;
  readonly chapters: ChapterReader;
  /** Self-service only: callers must check `profile.*_own` with ownerId = principal.userId. */
  readonly memberProfiles: MemberProfileRepository;
  /** Records the signed-in user's own sign-in (uid from the verified session). */
  readonly users: SignInRecorder;
}

export interface AdminRepositories {
  readonly content: ContentWriter;
  readonly events: EventReader;
  readonly chapters: ChapterReader;
  readonly memberProfiles: MemberProfileRepository;
  readonly users: UserDirectory;
  readonly roles: RoleReader;
}

export interface GatewayRepositories {
  readonly events: EventReader;
  readonly apiKeys: ApiKeyStore;
}

/** Shop repositories (products, categories, carts, orders) — Firestore, added with the shop phase. */
export type ShopRepositories = Readonly<Record<never, never>>;

export interface RepositoriesByRole {
  web_ro: WebRepositories;
  admin_rw: AdminRepositories;
  shop_rw: ShopRepositories;
  gateway_rw: GatewayRepositories;
}
