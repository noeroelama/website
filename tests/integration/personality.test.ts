import { beforeEach, describe, expect, it } from "vitest";
import { createFirestorePersonalityStore } from "@website/db/firestore";
import { PERSONALITY_ITEMS } from "@website/domain/recruitment";
import { signLink } from "@website/security";
import { createPersonalityTest } from "../../apps/web/src/server/personality";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestorePersonalityStore>[0];
const secret = "s".repeat(40);
let clock = new Date("2026-11-10T00:00:00Z");
let fake: ReturnType<typeof fakeFirestore>;
const store = () => createFirestorePersonalityStore(fake.db as unknown as Db);
const test = () => createPersonalityTest({ results: store(), secret, now: () => clock });
const answers = PERSONALITY_ITEMS.map((item) => item.key * 2);

beforeEach(() => {
  clock = new Date("2026-11-10T00:00:00Z");
  fake = fakeFirestore();
});

describe("personality test page (signed 7-day link, one result)", () => {
  it("scores on the server and stores ONE result that cannot be overwritten", async () => {
    const token = test().linkFor("ari");
    expect(await test().open(token)).toEqual({ uid: "ari", result: null });
    const first = await test().submit({ token, answers });
    expect(first).toMatchObject({
      ok: true,
      result: { full: "ENFJ-A", completedAt: clock },
    });
    expect(fake.docs.get("personalityResults/ari")).toMatchObject({ code: "ENFJ" });
    expect(await test().submit({ token, answers: answers.map((a) => -a) })).toEqual({
      ok: false,
      error: "taken",
    });
    expect((await store().get("ari"))?.full).toBe("ENFJ-A");
    expect(await test().open(token)).toMatchObject({ result: { full: "ENFJ-A" } });
    expect((await store().getMany(["ari", "budi"])).get("ari")?.code).toBe("ENFJ");
    expect((await store().getMany(["ari", "budi"])).has("budi")).toBe(false);
    expect(await store().get("a/b")).toBeNull();
  });

  it("refuses forged, expired, foreign-purpose and broken links", async () => {
    const token = test().linkFor("ari");
    const forged = signLink({ purpose: "personality", uid: "ari" }, "x".repeat(40));
    const foreign = signLink({ purpose: "unsubscribe", uid: "ari" }, secret);
    for (const bad of [forged, foreign, "not-a-token", "e30.%%%", `${token}x`]) {
      expect(await test().open(bad), bad).toBeNull();
      expect(await test().submit({ token: bad, answers })).toEqual({ ok: false, error: "link" });
    }
    clock = new Date("2026-11-17T00:00:01Z");
    expect(await test().open(token)).toBeNull();
    expect(await test().submit({ token, answers })).toEqual({ ok: false, error: "link" });
    expect(await test().submit({ answers })).toEqual({ ok: false, error: "link" });
    expect(fake.docs.has("personalityResults/ari")).toBe(false);
  });

  it("requires every answer", async () => {
    const token = test().linkFor("ari");
    expect(await test().submit({ token, answers: answers.slice(1) })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("does not hide unexpected storage errors", async () => {
    fake = fakeFirestore({ failWith: new Error("unavailable") });
    await expect(test().submit({ token: test().linkFor("ari"), answers })).rejects.toThrow(
      "unavailable",
    );
  });
});
