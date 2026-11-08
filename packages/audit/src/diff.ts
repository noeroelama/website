import type { JsonValue, Snapshot } from "./types";

export interface FieldChange {
  readonly path: string;
  readonly before: JsonValue | undefined;
  readonly after: JsonValue | undefined;
}

const isObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function diffSnapshots(
  before: Snapshot | null,
  after: Snapshot | null,
  prefix = "",
): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before?.[key];
    const b = after?.[key];
    if (isObject(a) && isObject(b)) {
      changes.push(...diffSnapshots(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path, before: a, after: b });
    }
  }
  return changes;
}
