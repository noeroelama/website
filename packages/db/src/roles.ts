import type { ApiKeyStore } from "@website/apikeys";
import type { ContentReader, ContentWriter } from "@website/domain/content";
import type { EventReader } from "@website/domain/events";
import type { MemberProfileRepository } from "@website/domain/members";
import type { ChapterReader } from "@website/domain/organizations";
import type { RoleReader, SignInRecorder, UserDirectory } from "./users";

export type DatabaseRole = "web_ro" | "admin_rw" | "shop_rw" | "gateway_rw";

export interface WebRepositories {
  readonly content: ContentReader;
  readonly events: EventReader;
  readonly chapters: ChapterReader;
  readonly memberProfiles: MemberProfileRepository;
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

export type ShopRepositories = Readonly<Record<never, never>>;

export interface RepositoriesByRole {
  web_ro: WebRepositories;
  admin_rw: AdminRepositories;
  shop_rw: ShopRepositories;
  gateway_rw: GatewayRepositories;
}
