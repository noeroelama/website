import { describe, expect, it } from "vitest";
import type { Disposition, IncomingLetter } from "@website/domain/documents";
import { dispositionTree, toIncomingItem } from "../../apps/admin/src/components/incoming-model";

const at = new Date("2026-11-03T02:00:00Z");
const d = (id: string, parentId: string | null, extra: Partial<Disposition> = {}): Disposition => ({
  id,
  parentId,
  fromUserId: "sekjen",
  toOrgUnitId: "media",
  toUserId: null,
  instruction: "x",
  dueDate: null,
  status: "waiting",
  response: null,
  createdAt: at,
  completedAt: null,
  ...extra,
});

describe("Incoming letters page model", () => {
  it("orders dispositions as a tree with depths", () => {
    const tree = dispositionTree([
      d("a", null),
      d("b", null),
      d("a1", "a"),
      d("a1x", "a1"),
      d("b1", "b"),
    ]);
    expect(tree.map((x) => `${x.id}:${x.depth}`)).toEqual(["a:0", "a1:1", "a1x:2", "b:0", "b1:1"]);
  });

  it("maps a letter with names and labels", () => {
    const letter = {
      id: "in1",
      version: 3,
      agendaNumber: "001/AG/XI/2026",
      sender: "KBRI",
      originNumber: "",
      subject: "Undangan",
      letterDate: null,
      receivedDate: "2026-11-03",
      summary: "",
      status: "disposed",
      scan: { path: "p", name: "scan.pdf", size: 1, sha256: "x" },
      recordedBy: "sekre",
      dispositions: [
        d("a", null, { status: "done", completedAt: at, response: "ok" }),
        d("a1", "a", { toOrgUnitId: null, toUserId: "ari" }),
      ],
    } as unknown as IncomingLetter;
    const item = toIncomingItem(
      letter,
      new Map([
        ["media", "Direktorat Media"],
        ["sekjen", "Rina"],
      ]),
    );
    expect(item).toMatchObject({
      statusLabel: "Disposed",
      scanName: "scan.pdf",
      recordedBy: "sekre",
    });
    expect(item.dispositions).toEqual([
      expect.objectContaining({
        id: "a",
        depth: 0,
        from: "Rina",
        to: "Direktorat Media",
        statusLabel: "Done",
        completedAt: at.toISOString(),
        response: "ok",
      }),
      expect.objectContaining({
        id: "a1",
        depth: 1,
        to: "ari",
        statusLabel: "Waiting",
        completedAt: null,
      }),
    ]);
    expect(toIncomingItem({ ...letter, scan: null }, new Map()).scanName).toBeNull();
  });
});
