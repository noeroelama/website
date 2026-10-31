import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase, type Database } from "@website/db/sql";

/**
 * Contract of the MySQL document store against a real MySQL 8 (CI starts one; locally set
 * TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/ppidk_test to run it). The repositories are
 * tested with tests/support/fake-db.ts, so the store must behave like that fake.
 */
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("MySQL document store", () => {
  let db: Database;
  const at = new Date("2026-03-04T05:06:07.890Z");

  beforeAll(async () => {
    db = getDatabase({ url: url as string, connectionLimit: 4 });
    // Every test starts from empty tables.
    const names = ["users", "events", "rateLimits", "eventCounters"];
    const found = await Promise.all(names.map((name) => db.collection(name).get()));
    const batch = db.batch();
    for (const doc of found.flatMap((q) => q.docs)) batch.delete(doc.ref);
    await batch.commit();
  });
  afterAll(() => db.close());

  it("round-trips documents, including nested dates", async () => {
    const ref = db.collection("users").doc("u1");
    await ref.set({
      email: "a@x.org",
      createdAt: at,
      roleAssignments: [{ roleId: "user", since: at }],
      offer: { expiresAt: at, unit: null },
      active: true,
    });
    const snapshot = await ref.get();
    expect(snapshot.exists).toBe(true);
    expect(snapshot.id).toBe("u1");
    expect(snapshot.get("offer.unit")).toBeNull();
    const data = snapshot.data() as Record<string, unknown>;
    expect((data["createdAt"] as { toDate(): Date }).toDate()).toEqual(at);
    const assignment = (data["roleAssignments"] as Array<Record<string, unknown>>)[0];
    expect((assignment?.["since"] as { toDate(): Date }).toDate()).toEqual(at);
    expect(data["active"]).toBe(true);
    expect((await db.collection("users").doc("missing").get()).exists).toBe(false);

    // A stored timestamp written back stays a date.
    await ref.set({ ...data, email: "b@x.org" });
    const again = (await ref.get()).data() as Record<string, unknown>;
    expect((again["createdAt"] as { toDate(): Date }).toDate()).toEqual(at);
    expect(again["email"]).toBe("b@x.org");
  });

  it("create refuses an existing id with ALREADY_EXISTS (6); update needs the document", async () => {
    const ref = db.collection("users").doc("u2");
    await ref.create({ n: 1 });
    await expect(ref.create({ n: 2 })).rejects.toMatchObject({ code: 6 });
    await ref.update({ n: 3, extra: "x" });
    expect((await ref.get()).data()).toEqual({ n: 3, extra: "x" });
    await expect(db.collection("users").doc("nope").update({ n: 1 })).rejects.toMatchObject({
      code: 5,
    });
    await ref.delete();
    expect((await ref.get()).exists).toBe(false);
  });

  it("queries like Firestore: filters, order, cursor, limit, count", async () => {
    const events = db.collection("events");
    await Promise.all([
      events.doc("e1").set({ status: "published", n: 1, tags: ["a", "b"], startsAt: at }),
      events.doc("e2").set({ status: "published", n: 3, tags: ["c"], startsAt: new Date(0) }),
      events.doc("e3").set({ status: "draft", n: 2, tags: [], startsAt: null }),
      events.doc("e4").set({ status: "draft", tags: ["a"] }),
    ]);
    const ids = async (q: { get(): Promise<{ docs: Array<{ id: string }> }> }) =>
      (await q.get()).docs.map((d) => d.id);

    expect(await ids(events.where("status", "==", "draft").orderBy("n"))).toEqual(["e3"]);
    expect(await ids(events.where("status", "in", ["draft", "x"]))).toEqual(["e3", "e4"]);
    expect(await ids(events.where("tags", "array-contains", "a"))).toEqual(["e1", "e4"]);
    expect(await ids(events.where("tags", "array-contains-any", ["b", "c"]))).toEqual(["e1", "e2"]);
    expect(await ids(events.where("n", ">=", 2))).toEqual(["e2", "e3"]);
    expect(await ids(events.where("startsAt", "<=", at))).toEqual(["e1", "e2"]);
    expect(await ids(events.where("startsAt", "==", at))).toEqual(["e1"]);
    expect(await ids(events.where("startsAt", "==", null))).toEqual(["e3"]);
    // orderBy skips documents without the field (e4), like Firestore.
    expect(await ids(events.orderBy("n", "desc"))).toEqual(["e2", "e3", "e1"]);
    expect(await ids(events.orderBy("n").startAfter(1).limit(1))).toEqual(["e3"]);
    expect(await ids(events.orderBy("status").orderBy("n", "desc").startAfter("draft", 2))).toEqual(
      ["e2", "e1"],
    );
    expect(await ids(events.where("status", "in", []))).toEqual([]);
    const count = await events.where("status", "==", "published").count().get();
    expect(count.data().count).toBe(2);

    const all = await db.getAll(
      events.doc("e2"),
      db.collection("users").doc("x"),
      events.doc("e1"),
    );
    expect(all.map((s) => [s.id, s.exists])).toEqual([
      ["e2", true],
      ["x", false],
      ["e1", true],
    ]);
    expect(await db.getAll()).toEqual([]);
  });

  it("transactions apply all writes or none", async () => {
    const ref = db.collection("eventCounters").doc("c1");
    await expect(
      db.runTransaction((tx) => {
        tx.set(ref, { confirmed: 1 });
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    expect((await ref.get()).exists).toBe(false);

    await expect(
      db.runTransaction(async (tx) => {
        tx.set(ref, { confirmed: 1 });
        await tx.get(ref);
      }),
    ).rejects.toThrow("reads before all writes");

    // A failed create rolls back the writes before it.
    await db.collection("eventCounters").doc("taken").set({ x: 1 });
    await expect(
      db.runTransaction((tx) => {
        tx.set(ref, { confirmed: 1 });
        tx.create(db.collection("eventCounters").doc("taken"), { x: 2 });
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect((await ref.get()).exists).toBe(false);
  });

  it("serializes concurrent read-modify-write on the same document", async () => {
    const ref = db.collection("rateLimits").doc("hot");
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          const n = snapshot.exists ? (snapshot.get("n") as number) : 0;
          tx.set(ref, { n: n + 1 });
        }),
      ),
    );
    expect((await ref.get()).get("n")).toBe(12);
  });

  it("supports query reads, update and delete inside a transaction, and batches", async () => {
    await db.collection("users").doc("t1").set({ role: "x", n: 1 });
    await db.runTransaction(async (tx) => {
      const found = await tx.get(db.collection("users").where("role", "==", "x"));
      expect(found.size).toBe(1);
      expect(found.empty).toBe(false);
      tx.update(db.collection("users").doc("t1"), { n: 2 });
      tx.create(db.collection("users").doc("t2"), { role: "y" });
    });
    expect((await db.collection("users").doc("t1").get()).get("n")).toBe(2);

    const batch = db.batch();
    batch.set(db.doc("users/t3"), { role: "z" });
    batch.update(db.doc("users/t1"), { n: 5 });
    batch.delete(db.doc("users/t2"));
    await batch.commit();
    expect((await db.collection("users").doc("t1").get()).get("n")).toBe(5);
    expect((await db.collection("users").doc("t2").get()).exists).toBe(false);
    expect((await db.collection("users").doc("t3").get()).exists).toBe(true);
  });

  it("refuses unknown collections and invalid values", () => {
    expect(() => db.collection("nope")).toThrow("Unknown collection");
    expect(() => db.doc("users")).toThrow("collection/id");
    return expect(db.collection("users").doc("bad").set({ n: Number.NaN })).rejects.toThrow(
      "finite",
    );
  });
});
