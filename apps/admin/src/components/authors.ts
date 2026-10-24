import type { AuditActor, AuditEvent } from "@website/audit";

/**
 * "Author" of a list row (Gallery, Event): whoever made the row's newest change, read from the
 * audit log. Pages read the audit entries and users/{uid} on the server, then map them here.
 */
export interface Author {
  /** Short name, e.g. "Nevyllo K.". */
  name: string;
  email: string;
  /** Avatar initials, e.g. "NK". */
  initials: string;
}

/**
 * Resource id → actor of its newest change. `entries` are audit entries, newest first (Audit Log
 * order), so the first entry seen for a resource wins. Other resource types are skipped.
 */
export function lastEditors(
  entries: readonly Pick<AuditEvent, "resourceType" | "resourceId" | "actor">[],
  resourceType: string,
): Map<string, AuditActor> {
  const editors = new Map<string, AuditActor>();
  for (const e of entries) {
    if (e.resourceType === resourceType && !editors.has(e.resourceId)) {
      editors.set(e.resourceId, e.actor);
    }
  }
  return editors;
}

/** "Nevyllo Zamuel Kalangi" → "Nevyllo K." / "NK"; without a name, the e-mail's local part. */
export function toAuthor(name: string | null, email: string | null): Author | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? email?.split("@")[0];
  if (!first) return null;
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return {
    name: last ? `${first} ${last[0]}.` : first,
    email: email ?? "",
    initials: `${first[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase(),
  };
}

/** Resource id → Author: the name comes from users/{uid}, the e-mail falls back to the audit one. */
export function authorsById(
  editors: ReadonlyMap<string, AuditActor>,
  users: ReadonlyMap<string, { name: string | null; email: string | null }>,
): Map<string, Author> {
  const authors = new Map<string, Author>();
  for (const [id, actor] of editors) {
    const user = users.get(actor.id);
    const author = toAuthor(user?.name ?? null, user?.email ?? actor.email ?? null);
    if (author) authors.set(id, author);
  }
  return authors;
}
