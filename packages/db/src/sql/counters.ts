import type { Database, Transaction } from "./store";

export async function nextNumbers(
  db: Database,
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
