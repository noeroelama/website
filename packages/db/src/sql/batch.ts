import type { Database } from "./store";
import { safeId } from "@website/security/validation";

const CHUNK = 100;

/**
 * Loads many documents by id in one round trip per 100 ids (avoids the N+1 query problem:
 * never call `doc(id).get()` inside a loop). Duplicate ids are fetched once; the result keeps
 * input order and maps missing documents to null.
 */
export async function getDocumentsByIds<T>(
  db: Database,
  collection: string,
  ids: readonly string[],
): Promise<Map<string, T | null>> {
  const unique = [...new Set(ids.map((id) => safeId.parse(id)))];
  const result = new Map<string, T | null>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const refs = unique.slice(i, i + CHUNK).map((id) => db.collection(collection).doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      result.set(snapshot.id, snapshot.exists ? (snapshot.data() as T) : null);
    }
  }
  return result;
}
