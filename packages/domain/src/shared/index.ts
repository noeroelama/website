/**
 * Minimal shared kernel. Keep this tiny — anything module-specific belongs in its module.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityId = Brand<string, "EntityId">;

/** Every editable entity carries these for optimistic concurrency, soft delete and auditing. */
export interface EntityMeta {
  readonly id: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export type Result<T, E extends string = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });

/** Injected clock so business rules are testable and never read global time implicitly. */
export interface Clock {
  now(): Date;
}

export class ConcurrencyConflictError extends Error {
  override readonly name = "ConcurrencyConflictError";
}

/**
 * A business rule refused the change. The message is written for staff and is safe to show
 * (e.g. "You cannot change your own roles."); never put internal details in it.
 */
export class RuleViolationError extends Error {
  override readonly name = "RuleViolationError";
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 120 && SLUG.test(slug);
}

export * from "./images";
export * from "./time";
