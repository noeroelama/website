import type { Database, Query } from "./store";

/** What the admin dashboard counts (COUNT queries). */
export type DashboardCounter = "events" | "albums" | "articles" | "subscribers";

export function createSqlDashboardCounts(db: Database) {
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

export type SqlDashboardCounts = ReturnType<typeof createSqlDashboardCounts>;
