import type { Firestore, Query } from "firebase-admin/firestore";

/** What the admin dashboard counts (Firestore aggregation count(): one read per 1000 docs). */
export type DashboardCounter = "events" | "albums" | "articles" | "subscribers";

export function createFirestoreDashboardCounts(db: Firestore) {
  const queries: Record<DashboardCounter, () => Query> = {
    events: () => db.collection("events").where("deletedAt", "==", null),
    albums: () => db.collection("galleries").where("deletedAt", "==", null),
    articles: () =>
      db.collection("content").where("kind", "==", "news").where("deletedAt", "==", null),
    subscribers: () => db.collection("subscribers").where("status", "==", "confirmed"),
  };
  return {
    async count(counter: DashboardCounter): Promise<number> {
      const snapshot = await queries[counter]().count().get();
      return snapshot.data().count;
    },
  };
}

export type FirestoreDashboardCounts = ReturnType<typeof createFirestoreDashboardCounts>;
