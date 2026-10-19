export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Snapshot = { readonly [key: string]: JsonValue };

export interface AuditActor {
  /** "member": a member's own change of their profile (website). */
  readonly type: "staff" | "system" | "api_client" | "member";
  readonly id: string;
  /** Snapshot of the staff e-mail at the time of the change (shown on the Audit Log page). */
  readonly email?: string | null;
}

/** What happened, as shown in the Audit Log headline ("[ACTION] [page] [title] - #id"). */
export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "PUBLISH",
  "UNPUBLISH",
  "SEND",
  "UPLOAD",
  "REVERT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRequestMeta {
  readonly requestId: string;
  readonly ipHash?: string;
  readonly userAgent?: string;
}

/**
 * One immutable audit record. There is deliberately no update/delete API anywhere.
 * before=null => create; after=null => delete (soft).
 */
export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  /** Admin page id (`ADMIN_PAGES` key) the change was made on; optional for older entries. */
  readonly module?: string;
  /** Record title at the time of the change, for the headline. */
  readonly title?: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Groups the rows touched by one admin operation; reverted as a unit. */
  readonly operationId: string;
  /** Only the top-level fields that changed (`onlyChangedFields`); null = create / delete. */
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  /** Side effects (emails sent, payments) cannot be undone. */
  readonly revertible: boolean;
  /** Set when this event is itself a revert. */
  readonly revertOf: string | null;
  readonly request: AuditRequestMeta;
  /** sha256(prevHash + canonical(event)) — computed by the writer. */
  readonly prevHash: string | null;
  readonly hash: string | null;
}

/**
 * Append-only writer, bound to ONE database transaction (the one that changes the record), so the
 * change and its audit entries commit or fail together. Obtained after the transaction's reads
 * and before its writes (Firestore: reads first); `append` only queues writes.
 */
export interface AuditAppender {
  append(event: AuditEvent): void;
}

export interface AuditLogReader {
  findById(id: string): Promise<AuditEvent | null>;
  findRevertOf(id: string): Promise<AuditEvent | null>;
}
