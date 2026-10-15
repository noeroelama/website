import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, type AuditEvent } from "@website/audit";
import { createFirestoreAuditWriter } from "@website/db/firestore";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreAuditWriter>[0];
const event = (id: string, title: string): AuditEvent => ({
  id,
  occurredAt: new Date("2026-10-16T02:00:00Z"),
  actor: { type: "staff", id: "uid-staff", email: "staff@example.org" },
  action: "UPDATE",
  module: "articles",
  title,
  resourceType: "content",
  resourceId: "n1",
  operationId: `op-${id}`,
  before: { title: "Old" },
  after: { title },
  versionBefore: 1,
  versionAfter: 2,
  revertible: true,
  revertOf: null,
  request: { requestId: "req-1" },
  prevHash: null,
  hash: null,
});
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const setup = () => {
  const fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  return { ...fake, db, writer: createFirestoreAuditWriter(db) };
};

describe("Firestore audit writer (append-only, hash chain, same transaction)", () => {
  it("chains every entry to the previous one: hash = sha256(prevHash + canonical JSON)", async () => {
    const { db, docs, writer } = setup();
    await db.runTransaction(async (tx) => {
      const audit = await writer.begin(tx);
      audit.append(event("a1", "First"));
      audit.append(event("a2", "Second")); // one operation may write several entries
    });
    await db.runTransaction(async (tx) => (await writer.begin(tx)).append(event("a3", "Third")));

    const stored = (id: string) => docs.get(`auditLogs/${id}`) as Record<string, unknown>;
    expect(stored("a1")["prevHash"]).toBeNull();
    expect(stored("a2")["prevHash"]).toBe(stored("a1")["hash"]);
    expect(stored("a3")["prevHash"]).toBe(stored("a2")["hash"]);
    expect([stored("a1")["seq"], stored("a2")["seq"], stored("a3")["seq"]]).toEqual([1, 2, 3]);
    expect(docs.get("auditChain/head")).toMatchObject({ hash: stored("a3")["hash"], seq: 3 });

    const recomputed = sha256(
      `${stored("a1")["hash"] as string}${canonicalJson(event("a2", "Second"))}`,
    );
    expect(stored("a2")["hash"]).toBe(recomputed);
  });

  it("a failed transaction leaves no audit row and does not move the chain head", async () => {
    const { db, docs, writer } = setup();
    await expect(
      db.runTransaction(async (tx) => {
        (await writer.begin(tx)).append(event("a1", "First"));
        throw new Error("the record write failed");
      }),
    ).rejects.toThrow("the record write failed");
    expect(docs.has("auditLogs/a1")).toBe(false);
    expect(docs.has("auditChain/head")).toBe(false);
  });

  it("refuses to overwrite an existing entry (entries are created, never set or updated)", async () => {
    const { db, docs, writer } = setup();
    await db.runTransaction(async (tx) => (await writer.begin(tx)).append(event("a1", "First")));
    await expect(
      db.runTransaction(async (tx) => (await writer.begin(tx)).append(event("a1", "Forged"))),
    ).rejects.toMatchObject({ code: 6 });
    expect((docs.get("auditLogs/a1") as Record<string, unknown>)["title"]).toBe("First");
  });
});

describe("architecture: the audit log has no update or delete path", () => {
  it("the writer only creates entries and only sets the chain head", () => {
    const source = readFileSync("packages/db/src/firestore/audit.ts", "utf8");
    expect(source).toMatch(/tx\.create\(/);
    expect(source).not.toMatch(
      /tx\.(update|delete)\(|\.doc\([^)]*\)\.(set|update|delete)\(|recursiveDelete|bulkWriter/,
    );
    // No other database code touches the audit collection.
    const others = execFileSync(
      "git",
      ["grep", "--untracked", "-l", '"auditLogs"', "--", "packages", "apps"],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n");
    expect(others).toEqual(["packages/db/src/firestore/audit.ts"]);
  });
});
