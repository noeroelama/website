export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Snapshot = { readonly [key: string]: JsonValue };

export interface AuditActor {
  readonly type: "staff" | "system" | "api_client" | "member";
  readonly id: string;
  readonly email?: string | null;
}

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

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  readonly module?: string;
  readonly title?: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly operationId: string;
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  readonly revertible: boolean;
  readonly revertOf: string | null;
  readonly request: AuditRequestMeta;
  readonly prevHash: string | null;
  readonly hash: string | null;
}

export interface AuditAppender {
  append(event: AuditEvent): void;
}

export interface AuditLogReader {
  findById(id: string): Promise<AuditEvent | null>;
  findRevertOf(id: string): Promise<AuditEvent | null>;
}
