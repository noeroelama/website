import type { JsonValue, Snapshot } from "./types";

const same = (a: JsonValue | undefined, b: JsonValue | undefined) =>
  canonicalJson(a ?? null) === canonicalJson(b ?? null);

export function onlyChangedFields(
  before: Snapshot | null,
  after: Snapshot | null,
): { before: Snapshot | null; after: Snapshot | null } {
  if (before === null || after === null) return { before, after };
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !same(before[key], after[key]),
  );
  const pick = (side: Snapshot) => Object.fromEntries(changed.map((k) => [k, side[k] ?? null]));
  return { before: pick(before), after: pick(after) };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, inner]) => inner !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, inner]) => [key, normalize(inner)]),
    );
  }
  return value;
}
