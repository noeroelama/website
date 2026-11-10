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
  can,
  canAccessAdmin,
  canInSomeScope,
  type AdminPageId,
  type PagePermission,
  type Permission,
  type Principal,
  type ResourceContext,
} from "@website/permissions";

export type GuardedResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_input"
        | "conflict"
        | "refused"
        | "reauthenticate";
      readonly issues?: readonly string[];
      readonly fields?: Readonly<Record<string, string>>;
    };

export interface AuditContext {
  readonly actorEmail: string | null;
  readonly requestId: string;
  readonly authTime: number | null;
}

export interface AuditInput {
  readonly module: AdminPageId;
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly title: string;
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  readonly revertible?: boolean;
}

export type AuditBuilder = (input: AuditInput) => AuditEvent;

const noContext = (): Promise<AuditContext> =>
  Promise.resolve({ actorEmail: null, requestId: randomUUID(), authTime: null });

export function createGuardedAction<S extends z.ZodType, T>(definition: {
  permission: Permission;
  input: S;
  resource?: (input: z.infer<S>) => ResourceContext | Promise<ResourceContext>;
  inSomeScope?: boolean;
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
      if (!canAccessAdmin(principal)) return { ok: false, error: "forbidden" };

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
      if (definition.inSomeScope) {
        if (!canInSomeScope(principal, definition.permission as PagePermission)) {
          return { ok: false, error: "forbidden" };
        }
      } else {
        // A record that is missing or out of reach reads as "forbidden" on purpose (no existence
        // oracle), but a failing database is an error, never a permission answer.
        let resource: ResourceContext | undefined;
        try {
          resource = await definition.resource?.(parsed.data);
        } catch (error) {
          if (error instanceof Error && error.name === "RuleViolationError") {
            return { ok: false, error: "forbidden" };
          }
          throw error;
        }
        if (!can(principal, definition.permission, resource)) {
          return { ok: false, error: "forbidden" };
        }
      }
      const context = await getAuditContext();
      if (
        definition.recentSignIn &&
        (context.authTime === null ||
          !isRecentSignIn({ authTime: context.authTime }, Date.now() / 1000))
      ) {
        return { ok: false, error: "reauthenticate" };
      }
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
        if (toPublicError(error).code === "conflict") return { ok: false, error: "conflict" };
        if (error instanceof Error && error.name === "RuleViolationError") {
          return { ok: false, error: "refused", issues: [error.message] };
        }
        throw error;
      }
    };
}
