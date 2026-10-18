import "server-only";
import { z } from "zod";
import type { FirestoreEventStore, FirestoreGalleryStore } from "@website/db/firestore";
import { AlbumInputSchema, canHaveAlbum, type Album } from "@website/domain/gallery";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface GalleryDeps {
  readonly albums: Pick<FirestoreGalleryStore, "write">;
  readonly events: Pick<FirestoreEventStore, "get">;
  readonly now: () => Date;
}

const SaveInput = AlbumInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
  /** true = Publish, false = Save draft. */
  publish: z.boolean(),
}).strict();
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE";

/** Audit entry for one album change (module `gallery`, resource `album`). */
const albumAudit =
  (audit: AuditBuilder, action: Action, revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Album | null,
    next: Album,
  ) =>
    audit({
      module: "gallery",
      action,
      resourceType: "album",
      resourceId: next.id,
      title: next.eventTitle,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

/** Admin Gallery page actions: save (draft / publish), publish toggle, trash. */
export function createGalleryActions(deps: GalleryDeps) {
  const save = createGuardedAction({
    permission: "gallery.edit",
    input: SaveInput,
    handler: async (input, _principal, audit) => {
      const event = await deps.events.get(input.eventId);
      if (!event || !canHaveAlbum(event)) {
        throw new RuleViolationError("Choose a published event for this album.");
      }
      let action: Action = "CREATE";
      let revertible = true;
      const saved = await deps.albums.write(
        input.id ?? null,
        input.version,
        (current) => {
          const slug = input.slug || current?.slug || event.slug;
          if (current) {
            action = input.publish && !current.published ? "PUBLISH" : "UPDATE";
            // A changed URL would leave the slug index behind on revert: never revertible.
            revertible = current.slug === slug;
          }
          return {
            slug,
            eventId: event.id,
            eventTitle: event.title,
            images: input.images,
            totalPhotos: input.totalPhotos,
            albumUrl: input.albumUrl,
            published: input.publish,
            deletedAt: null,
          };
        },
        (before, after, current, next) =>
          albumAudit(audit, action, revertible)(before, after, current, next),
        deps.now(),
      );
      return { id: saved.id, slug: saved.slug, version: saved.version };
    },
  });

  const setPublished = createGuardedAction({
    permission: "gallery.edit",
    input: RefInput.extend({ published: z.boolean() }).strict(),
    handler: async ({ id, version, published }, _principal, audit) => {
      const saved = await deps.albums.write(
        id,
        version,
        (current) => ({ ...(current as Album), published }),
        albumAudit(audit, published ? "PUBLISH" : "UNPUBLISH"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "gallery.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.albums.write(
        id,
        version,
        (current) => ({ ...(current as Album), deletedAt: now }),
        albumAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  return { save, setPublished, remove };
}
