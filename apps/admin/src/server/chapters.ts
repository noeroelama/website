import "server-only";
import { z } from "zod";
import type { FirestoreChapterStore } from "@website/db/firestore";
import { slugify } from "@website/domain/content";
import { ChapterInputSchema, type Chapter } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ChapterDeps {
  readonly chapters: Pick<FirestoreChapterStore, "write">;
  readonly now: () => Date;
}

const SaveInput = ChapterInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
}).strict();

/** Audit entry for one chapter change (module `organizations`, resource `chapter`). */
const chapterAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE", revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Chapter | null,
    next: Chapter,
  ) =>
    audit({
      module: "organizations",
      action,
      resourceType: "chapter",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

/** Organizations → PPI actions: save (add/edit) and activate/deactivate. There is no delete. */
export function createChapterActions(deps: ChapterDeps) {
  const save = createGuardedAction({
    permission: "organizations.edit",
    input: SaveInput,
    handler: async ({ id, version, slug: typedSlug, ...input }, _principal, audit) => {
      let revertible = true;
      const saved = await deps.chapters.write(
        id ?? null,
        version,
        (current) => {
          const slug = typedSlug || current?.slug || slugify(input.name);
          if (!slug) throw new RuleViolationError("Use letters or numbers in the name or URL.");
          // A changed URL would leave the slug index behind on revert: never revertible.
          if (current) revertible = current.slug === slug;
          return { ...input, slug, active: current?.active ?? true, deletedAt: null };
        },
        (before, after, current, next) =>
          chapterAudit(audit, current ? "UPDATE" : "CREATE", revertible)(
            before,
            after,
            current,
            next,
          ),
        deps.now(),
      );
      return { id: saved.id, slug: saved.slug, version: saved.version };
    },
  });

  /** Deactivate (hidden from the map and About) or activate again; never deletes. */
  const setActive = createGuardedAction({
    permission: "organizations.edit",
    input: z.object({ id: safeId, version: z.number().int().min(1), active: z.boolean() }).strict(),
    handler: async ({ id, version, active }, _principal, audit) => {
      const saved = await deps.chapters.write(
        id,
        version,
        (current) => ({ ...(current as Chapter), active }),
        chapterAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  return { save, setActive };
}
