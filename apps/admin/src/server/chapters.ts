import "server-only";
import { z } from "zod";
import type { FirestoreChapterStore } from "@website/db/firestore";
import { slugify } from "@website/domain/content";
import { ChapterInputSchema, type Chapter } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { can } from "@website/permissions";
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

/**
 * What only the national board changes. A chapter admin (organizations.edit for its chapter) may
 * change the rest: the contact person, public contact, website, e-mail, Instagram and links.
 */
const BOARD_FIELDS = [
  "name",
  "countryCode",
  "timezone",
  "logo",
  "latitude",
  "longitude",
  "slug",
] as const satisfies readonly (keyof Chapter)[];

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

/**
 * Organizations → PPI actions: save (add/edit) and activate/deactivate. There is no delete.
 * The national board (global organizations.edit) changes everything; a chapter admin (the
 * permission for one chapter) only the contact fields of that chapter.
 */
export function createChapterActions(deps: ChapterDeps) {
  const save = createGuardedAction({
    permission: "organizations.edit",
    input: SaveInput,
    // Creating needs the global permission; editing is checked against the chapter itself.
    resource: (input) => (input.id ? { chapterId: input.id } : {}),
    handler: async ({ id, version, slug: typedSlug, ...input }, principal, audit) => {
      const contactOnly = !can(principal, "organizations.edit");
      let revertible = true;
      const saved = await deps.chapters.write(
        id ?? null,
        version,
        (current) => {
          const slug = typedSlug || current?.slug || slugify(input.name);
          if (!slug) throw new RuleViolationError("Use letters or numbers in the name or URL.");
          // A changed URL would leave the slug index behind on revert: never revertible.
          if (current) revertible = current.slug === slug;
          const next = { ...input, slug, active: current?.active ?? true, deletedAt: null };
          // contactOnly always edits an existing chapter (creating needs the global permission).
          const before = current as Chapter;
          const changed = (key: (typeof BOARD_FIELDS)[number]) =>
            JSON.stringify(next[key]) !== JSON.stringify(before[key]);
          if (contactOnly && BOARD_FIELDS.some(changed)) {
            throw new RuleViolationError(
              "Only the contact details of your chapter can be changed here.",
            );
          }
          return next;
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
