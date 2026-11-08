import { createHash } from "node:crypto";
import type { Survey, SurveySource } from "@website/domain/messaging";
import { toDate } from "./slugged";
import type { Database } from "./store";

const surveyId = (source: string, sourceId: string, uid: string) =>
  createHash("sha256").update(`${source}:${sourceId}:${uid}`).digest("hex");

const toSurvey = (id: string, d: Record<string, unknown>): Survey => ({
  id,
  source: d["source"] as SurveySource,
  sourceId: d["sourceId"] as string,
  uid: d["uid"] as string,
  pollMessageId: (d["pollMessageId"] as string | null) ?? null,
  options: d["options"] as Record<string, number>,
  stars: (d["stars"] as number | null) ?? null,
  sentAt: toDate(d["sentAt"]) as Date,
  votedAt: toDate(d["votedAt"]),
});

export function createSqlSurveyStore(db: Database) {
  const docs = db.collection("surveys");
  return {
    async claim(
      source: SurveySource,
      sourceId: string,
      uid: string,
      options: Readonly<Record<string, number>>,
      now: Date,
    ): Promise<Survey | null> {
      const ref = docs.doc(surveyId(source, sourceId, uid));
      return db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return null;
        const data = {
          source,
          sourceId,
          uid,
          pollMessageId: null,
          options,
          stars: null,
          sentAt: now,
          votedAt: null,
        };
        tx.create(ref, data);
        return toSurvey(ref.id, data);
      });
    },

    async setPollMessage(id: string, pollMessageId: string): Promise<void> {
      await db.runTransaction(async (tx) => {
        tx.update(docs.doc(id), { pollMessageId });
        return Promise.resolve();
      });
    },

    async vote(
      pollMessageId: string,
      stars: (survey: Survey) => number | null,
      now: Date,
    ): Promise<boolean> {
      const found = await docs.where("pollMessageId", "==", pollMessageId).limit(1).get();
      const doc = found.docs[0];
      if (!doc) return false;
      return db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        const survey = toSurvey(doc.id, current.data() as Record<string, unknown>);
        tx.update(doc.ref, { stars: stars(survey), votedAt: now });
        return true;
      });
    },

    async since(from: Date): Promise<Survey[]> {
      const snapshot = await docs.where("sentAt", ">=", from).get();
      return snapshot.docs.map((d) => toSurvey(d.id, d.data()));
    },
  };
}

export type SqlSurveyStore = ReturnType<typeof createSqlSurveyStore>;
