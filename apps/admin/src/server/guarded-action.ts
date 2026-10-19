import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  onlyChangedFields,
  type AuditAction,
  type AuditEvent,
  type Snapshot,
} from "@website/audit";
import { isRecentSignIn } from "@website/auth";
import { toPublicError } from "@website/security";
import {
  canAccessAdmin,
  requirePermission,
  type AdminPageId,
  type Permission,
  type Principal,
  type ResourceContext,
} from "@website/permissions";

/**
 * The ONLY way to define an admin mutation. Order is fixed:
 * authenticate (+ staff role) → validate → authorize → business logic. The handler gets an
 * `audit` builder (actor = the server-side principal, never the input) and writes the entry with
 * `createFirestoreAuditWriter(db).begin(tx)` in the SAME transaction as the record change.
 *
 * Kept free of `server-only` so it is unit-testable; it is wired in ./context.ts.
 */
export type GuardedResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_input"
        | "conflict"
        /** A business rule refused it; `issues[0]` is a message written for staff. */
        | "refused"
        /** The action needs a sign-in in the last 15 minutes. */
        | "reauthenticate";
      readonly issues?: readonly string[];
      /** invalid_input: first message per top-level field, to show under that field. */
      readonly fields?: Readonly<Record<string, string>>;
    };

/** Who and which request, resolved on the server (context.ts → getAuditContext). */
export interface AuditContext {
  readonly actorEmail: string | null;
  readonly requestId: string;
  /** Seconds since epoch of the last real sign-in (session); null when unknown. */
  readonly authTime: number | null;
}

/** What a handler says about one change; the rest of the AuditEvent is filled in for it. */
export interface AuditInput {
  readonly module: AdminPageId;
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly title: string;
  /** Full snapshots; only the changed top-level fields are kept. Redact personal data first. */
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  /** false for side effects that cannot be undone (e-mail sent). Default true. */
  readonly revertible?: boolean;
}

/** Builds an audit entry for this mutation; write it with the transaction's AuditAppender. */
export type AuditBuilder = (input: AuditInput) => AuditEvent;

const noContext = (): Promise<AuditContext> =>
  Promise.resolve({ actorEmail: null, requestId: randomUUID(), authTime: null });

export function createGuardedAction<S extends z.ZodType, T>(definition: {
  permission: Permission;
  input: S;
  /**
   * The resource the permission is checked against. May read it on the server (e.g. a member's
   * chapter), never from client-supplied scope fields.
   */
  resource?: (input: z.infer<S>) => ResourceContext | Promise<ResourceContext>;
  /** Sensitive actions (role changes, revert): refuse unless signed in within 15 minutes. */
  recentSignIn?: boolean;
  handler: (input: z.infer<S>, principal: Principal, audit: AuditBuilder) => Promise<T>;
}) {
  return (
      getPrincipal: () => Promise<Principal | null>,
      getAuditContext: () => Promise<AuditContext> = noContext,
    ) =>
    async (rawInput: unknown): Promise<GuardedResult<T>> => {
      const principal = await getPrincipal();
      if (principal === null || !principal.active) return { ok: false, error: "unauthenticated" };
      // One user pool: a member or customer account is authenticated but is not staff.
      if (!canAccessAdmin(principal)) return { ok: false, error: "forbidden" };

      // Validate before resource-scoped authorization (scope may depend on input),
      // but never reveal validation details to unauthenticated callers.
      const parsed = definition.input.safeParse(rawInput);
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string") fields[field] ??= issue.message;
        }
        return {
          ok: false,
          error: "invalid_input",
          issues: parsed.error.issues.map((i) => i.message),
          fields,
        };
      }
      try {
        requirePermission(
          principal,
          definition.permission,
          await definition.resource?.(parsed.data),
        );
      } catch {
        return { ok: false, error: "forbidden" };
      }
      const context = await getAuditContext();
      if (
        definition.recentSignIn &&
        (context.authTime === null ||
          !isRecentSignIn({ authTime: context.authTime }, Date.now() / 1000))
      ) {
        return { ok: false, error: "reauthenticate" };
      }
      // One operation id per mutation: entries written by it are reverted as a unit.
      const operationId = randomUUID();
      const audit: AuditBuilder = ({ revertible = true, ...change }) => ({
        ...change,
        ...onlyChangedFields(change.before, change.after),
        id: randomUUID(),
        occurredAt: new Date(),
        actor: { type: "staff", id: principal.userId, email: context.actorEmail },
        operationId,
        revertible,
        revertOf: null,
        request: { requestId: context.requestId },
        prevHash: null,
        hash: null,
      });
      try {
        return { ok: true, data: await definition.handler(parsed.data, principal, audit) };
      } catch (error) {
        // Race condition: the document changed since it was read (optimistic concurrency).
        if (toPublicError(error).code === "conflict") return { ok: false, error: "conflict" };
        // A business rule refused it with a message written for staff.
        if (error instanceof Error && error.name === "RuleViolationError") {
          return { ok: false, error: "refused", issues: [error.message] };
        }
        throw error; // unexpected: Next.js logs it and shows the client a generic error
      }
    };
}
