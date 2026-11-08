import { describe, expect, it } from "vitest";
import type { PasskeyCredential, PasskeyStore } from "@website/auth";
import { createSqlPasskeyStore } from "@website/db/sql";
import { createMemoryPasskeyStore } from "@website/db/memory";
import { fakeDb } from "../support/fake-db";

type Firestore = Parameters<typeof createSqlPasskeyStore>[0];
const now = new Date("2026-10-07T10:00:00Z");
const credential = (over: Partial<PasskeyCredential> = {}): PasskeyCredential => ({
  id: "cred-A_1",
  userId: "alice",
  publicKey: "pk",
  counter: 0,
  transports: ["internal"],
  createdAt: now,
  lastUsedAt: null,
  ...over,
});

describe.each([
  ["memory", () => createMemoryPasskeyStore()],
  ["firestore", () => createSqlPasskeyStore(fakeDb().db as unknown as Firestore)],
] as Array<[string, () => PasskeyStore]>)("%s passkey store", (_name, create) => {
  it("stores credentials and finds them by id and by user", async () => {
    const store = create();
    await store.add(credential());
    await store.add(credential({ id: "cred-B", userId: "bob" }));
    expect(await store.findById("cred-A_1")).toEqual(credential());
    expect((await store.listByUser("alice")).map((c) => c.id)).toEqual(["cred-A_1"]);
    expect(await store.findById("missing")).toBeNull();
  });

  it("refuses to overwrite an existing credential", async () => {
    const store = create();
    await store.add(credential());
    await expect(store.add(credential({ userId: "mallory" }))).rejects.toThrow();
    expect((await store.findById("cred-A_1"))?.userId).toBe("alice");
  });

  it("accepts only increasing signature counters (clone detection); 0 → 0 is allowed for synced passkeys", async () => {
    const store = create();
    await store.add(credential());
    expect(await store.recordUse("cred-A_1", 0, now)).toBe(true);
    expect(await store.recordUse("cred-A_1", 2, now)).toBe(true);
    expect(await store.recordUse("cred-A_1", 2, now)).toBe(false);
    expect(await store.recordUse("cred-A_1", 1, now)).toBe(false);
    expect(await store.recordUse("unknown", 9, now)).toBe(false);
    expect(await store.findById("cred-A_1")).toMatchObject({ counter: 2, lastUsedAt: now });
  });

  it("challenges are single-use and expire", async () => {
    const store = create();
    const expiresAt = new Date(now.getTime() + 60_000);
    await store.saveChallenge("c1", { challenge: "abc", userId: "alice", expiresAt });
    expect(await store.consumeChallenge("c1", now)).toEqual({
      challenge: "abc",
      userId: "alice",
      expiresAt,
    });
    expect(await store.consumeChallenge("c1", now)).toBeNull();
    await store.saveChallenge("c2", { challenge: "def", userId: null, expiresAt });
    expect(await store.consumeChallenge("c2", new Date(expiresAt.getTime() + 1))).toBeNull();
    expect(await store.consumeChallenge("c2", now)).toBeNull();
  });

  it("rejects ids that could address other documents", async () => {
    const store = create();
    await expect(store.consumeChallenge("../users/x", now)).rejects.toThrow();
  });
});
