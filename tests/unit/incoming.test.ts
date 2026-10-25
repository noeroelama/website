import { describe, expect, it } from "vitest";
import {
  agendaNumber,
  archiveIncoming,
  completeDisposition,
  dispose,
  DispositionInputSchema,
  IncomingInputSchema,
  scanPath,
  type IncomingLetter,
} from "@website/domain/documents";

const now = new Date("2026-11-03T02:00:00Z");
const letter: IncomingLetter = {
  id: "in1",
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...IncomingInputSchema.parse({
    sender: "KBRI Tokyo",
    subject: "Undangan",
    receivedDate: "2026-11-03",
  }),
  periodId: "p1",
  agendaNumber: "001/AG/XI/2026",
  status: "new",
  scan: null,
  recordedBy: "sekre",
  dispositions: [],
};
const to = (extra: Partial<Parameters<typeof DispositionInputSchema.parse>[0]> = {}) =>
  DispositionInputSchema.parse({
    toOrgUnitId: "media",
    toUserId: null,
    instruction: "Siapkan balasan",
    ...extra,
  });

describe("incoming letters (D6)", () => {
  it("agenda numbers follow PPIDK: 042/AG/VIII/2026", () => {
    expect(agendaNumber(42, "2026-08-14")).toBe("042/AG/VIII/2026");
    expect(agendaNumber(1234, "2026-12-01")).toBe("1234/AG/XII/2026");
    expect(scanPath("p1", "in1", "abcdef12-3456")).toBe("letters/incoming/p1/in1_abcdef12.pdf");
    expect(
      IncomingInputSchema.parse({ sender: "A", subject: "B", receivedDate: "2026-11-03" }),
    ).toMatchObject({
      originNumber: "",
      letterDate: null,
      summary: "",
    });
  });

  it("disposes to a unit or a person; forwarding keeps the parent in progress", () => {
    expect(() => dispose(letter, to({ toUserId: "ari" }), "s", "d1", now)).toThrow(
      "either a unit or a person",
    );
    expect(() => dispose(letter, to({ toOrgUnitId: null }), "s", "d1", now)).toThrow(
      "either a unit or a person",
    );
    const one = dispose(letter, to(), "sekjen", "d1", now);
    expect(one).toMatchObject({
      status: "disposed",
      dispositions: [
        { id: "d1", parentId: null, status: "waiting", fromUserId: "sekjen", dueDate: null },
      ],
    });
    const two = dispose(
      one,
      to({ toOrgUnitId: null, toUserId: "ari", parentId: "d1", dueDate: "2026-11-10" }),
      "dir",
      "d2",
      now,
    );
    expect(two.dispositions.map((d) => [d.id, d.status])).toEqual([
      ["d1", "in_progress"],
      ["d2", "waiting"],
    ]);
    const three = dispose(two, to({ parentId: "d2" }), "ari", "d3", now);
    expect(three.dispositions.map((d) => d.status)).toEqual([
      "in_progress",
      "in_progress",
      "waiting",
    ]);
    expect(() => dispose(one, to({ parentId: "nope" }), "s", "d3", now)).toThrow(
      "not part of this letter",
    );
    expect(() => dispose({ ...letter, status: "archived" }, to(), "s", "d1", now)).toThrow(
      "archived",
    );
  });

  it("a disposition closes only after everything below it; then the letter is done and can be archived", () => {
    const tree = dispose(
      dispose(letter, to(), "s", "d1", now),
      to({ parentId: "d1" }),
      "dir",
      "d2",
      now,
    );
    expect(() => completeDisposition(tree, "d1", "", now)).toThrow("not done yet");
    expect(() => archiveIncoming(tree)).toThrow("not done yet");
    const child = completeDisposition(tree, "d2", " Sudah dibalas ", now);
    expect(child.dispositions[1]).toMatchObject({
      status: "done",
      response: "Sudah dibalas",
      completedAt: now,
    });
    expect(child.status).toBe("disposed");
    const done = completeDisposition(child, "d1", "", now);
    expect(done).toMatchObject({ status: "done" });
    expect(done.dispositions[0]?.response).toBeNull();
    expect(() => completeDisposition(done, "d1", "", now)).toThrow("already done");
    expect(() => completeDisposition(done, "x", "", now)).toThrow("not part of this letter");
    expect(() => dispose(done, to({ parentId: "d1" }), "s", "d3", now)).toThrow(
      "cannot be forwarded",
    );
    const archived = archiveIncoming(done);
    expect(archived.status).toBe("archived");
    expect(() => archiveIncoming(archived)).toThrow("already archived");
    expect(archiveIncoming(letter).status).toBe("archived");
  });
});
