import type { Firestore, Transaction } from "firebase-admin/firestore";

/**
 * Reserves `count` numbers from the counter document `{collection}/{id}` (`{ last }`) inside the caller's
 * transaction (letters, certificate sheets, incoming-letter agenda numbers). Numbers are never
 * given back, so a cancelled letter keeps its number. It READS the counter: call it before the
 * transaction's first write.
 */
export async function nextNumbers(
  db: Firestore,
  tx: Transaction,
  counter: { readonly collection: string; readonly id: string },
  count: number,
) {
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer.");
  const ref = db.collection(counter.collection).doc(counter.id);
  const snapshot = await tx.get(ref);
  const first = (snapshot.exists ? (snapshot.get("last") as number) : 0) + 1;
  const last = first + count - 1;
  tx.set(ref, { last });
  return { first, last };
}
