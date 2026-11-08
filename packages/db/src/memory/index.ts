export { createMemoryPasskeyStore } from "./passkeys";
import type { ApiKeyRecord } from "@website/apikeys";
import type { EventEntity } from "@website/domain/events";
import type { GatewayRepositories } from "../roles";

export function createMemoryGatewayRepositories(
  seed: {
    events?: readonly EventEntity[];
    apiKeys?: readonly ApiKeyRecord[];
  } = {},
): GatewayRepositories {
  const events = [...(seed.events ?? [])];
  const apiKeys = new Map((seed.apiKeys ?? []).map((key) => [key.keyId, key]));
  return {
    events: {
      listPublished({ chapterId, updatedSince, cursor, limit }) {
        const filtered = events
          .filter((e) => e.published && e.deletedAt === null)
          .filter((e) => chapterId === undefined || e.chapterId === chapterId)
          .filter((e) => updatedSince === undefined || e.updatedAt > updatedSince)
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter((e) => cursor === undefined || e.id > cursor);
        const items = filtered.slice(0, limit);
        const last = items.at(-1);
        return Promise.resolve({
          items,
          nextCursor: filtered.length > limit && last ? last.id : null,
        });
      },
      findById(id) {
        return Promise.resolve(events.find((e) => e.id === id) ?? null);
      },
    },
    apiKeys: {
      findByKeyId(keyId) {
        return Promise.resolve(apiKeys.get(keyId) ?? null);
      },
    },
  };
}
