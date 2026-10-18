import "server-only";
import { z } from "zod";
import type { FirestoreEventStore } from "@website/db/firestore";
import { EventInputSchema, randomEventSlug, type EventEntity } from "@website/domain/events";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface EventDeps {
  readonly events: Pick<FirestoreEventStore, "write">;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const SaveInput = EventInputSchema.and(
  z
    .object({
      id: safeId.optional(),
      version: z.number().int().min(1).nullable(),
      /** true = Publish now, false = Save draft. */
      publish: z.boolean(),
    })
    .strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE";

/** Audit entry for one event change (module `events`, resource `event`). */
const eventAudit =
  (audit: AuditBuilder, action: Action, revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: EventEntity | null,
    next: EventEntity,
  ) =>
    audit({
      module: "events",
      action,
      resourceType: "event",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

/** Admin Event page actions: save (draft / publish now), publish toggle, trash. */
export function createEventActions(deps: EventDeps) {
  const save = createGuardedAction({
    permission: "events.edit",
    input: SaveInput,
    handler: async (input, _principal, audit) => {
      const now = deps.now();
      let action: Action = "CREATE";
      let revertible = true;
      const saved = await deps.events.write(
        input.id ?? null,
        input.version,
        (current) => {
          const slug = input.slug || current?.slug || randomEventSlug(deps.uuid());
          if (current) {
            action = input.publish && !current.published ? "PUBLISH" : "UPDATE";
            // A changed URL would leave the slug index behind on revert: never revertible.
            revertible = current.slug === slug;
          }
          return {
            slug,
            title: input.title,
            summary: current?.summary ?? null,
            startsAt: input.startsAt,
            endsAt: current?.endsAt ?? null,
            timezone: input.timezone,
            location: input.location,
            chapterId: current?.chapterId ?? null,
            published: input.publish,
            capacity: current?.capacity ?? null,
            registrationClosesAt: input.registrationClosesAt,
            type: input.type,
            description: input.description,
            bannerImage: input.bannerImage,
            registrationUrl: input.registrationUrl,
            schedule: input.schedule,
            speakers: input.speakers,
            sponsors: input.sponsors.map((s, i) => ({ ...s, order: i + 1 })),
            deletedAt: null,
          };
        },
        (before, after, current, next) =>
          eventAudit(audit, action, revertible)(before, after, current, next),
        now,
      );
      return { id: saved.id, slug: saved.slug, version: saved.version };
    },
  });

  const setPublished = createGuardedAction({
    permission: "events.edit",
    input: RefInput.extend({ published: z.boolean() }).strict(),
    handler: async ({ id, version, published }, _principal, audit) => {
      const saved = await deps.events.write(
        id,
        version,
        (current) => ({ ...(current as EventEntity), published }),
        eventAudit(audit, published ? "PUBLISH" : "UNPUBLISH"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "events.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.events.write(
        id,
        version,
        (current) => ({ ...(current as EventEntity), deletedAt: now }),
        eventAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  return { save, setPublished, remove };
}
