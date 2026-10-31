import { describe, expect, it } from "vitest";
import { nextNumbers } from "@website/db/sql";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof nextNumbers>[0];

describe("atomic number counters", () => {
  it("reserves ranges that never overlap and never go back", async () => {
    const fake = fakeDb();
    const db = fake.db as unknown as Db;
    const reserve = (count: number) =>
      db.runTransaction((tx) =>
        nextNumbers(db, tx, { collection: "letterCounters", id: "p1_t1" }, count),
      );
    expect(await reserve(1)).toEqual({ first: 1, last: 1 });
    expect(await reserve(250)).toEqual({ first: 2, last: 251 });
    expect(await reserve(1)).toEqual({ first: 252, last: 252 });
    expect(fake.docs.get("letterCounters/p1_t1")).toEqual({ last: 252 });
    await expect(reserve(0)).rejects.toThrow("count");
  });
});
