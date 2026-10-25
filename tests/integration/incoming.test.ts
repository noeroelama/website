import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreIncomingStore } from "@website/db/firestore";
import type { IncomingLetter } from "@website/domain/documents";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createIncomingActions } from "../../apps/admin/src/server/incoming";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreIncomingStore>[0];
const clock = new Date("2026-11-03T02:00:00Z");
const staff = (permissions: string[], active = true): Principal => ({
  kind: "user",
  userId: "sekre",
  active,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const secretariat = staff(["incoming.edit", "incoming.dispose"]);
const context = () =>
  Promise.resolve({ actorEmail: "s@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const pdf = new TextEncoder().encode("%PDF-1.7 scan");

let fake: ReturnType<typeof fakeFirestore>;
let files: Map<string, Uint8Array>;
let uuid = 0;
const store = () => createFirestoreIncomingStore(fake.db as unknown as Db);
const actions = () =>
  createIncomingActions({
    letters: store(),
    unitPeriod: (id) => Promise.resolve(id === "media" ? "p1" : id === "old" ? "p0" : null),
    userExists: (uid) => Promise.resolve(uid === "ari"),
    storage: {
      save: (path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
      read: (path) => Promise.resolve(files.get(path) ?? null),
    },
    now: () => clock,
    uuid: () => `0000000${(uuid += 1)}-aaaa`,
  });

const received = { sender: "KBRI Tokyo", subject: "Undangan diskusi", receivedDate: "2026-11-03" };

beforeEach(() => {
  fake = fakeFirestore();
  files = new Map();
  uuid = 0;
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
});

async function recorded() {
  const result = await actions().record(...as(secretariat))(received);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
}

describe("incoming letters (D6)", () => {
  it("records with the next agenda number of the period, in one transaction", async () => {
    expect(await recorded()).toMatchObject({ version: 1, agendaNumber: "001/AG/XI/2026" });
    expect((await recorded()).agendaNumber).toBe("002/AG/XI/2026");
    expect(fake.docs.get("incomingCounters/p1")).toEqual({ last: 2 });
    const listed = await store().list("p1", 10);
    expect(listed.map((l) => l.agendaNumber).sort()).toEqual(["001/AG/XI/2026", "002/AG/XI/2026"]);
    expect(listed[0]).toMatchObject({
      status: "new",
      recordedBy: "sekre",
      scan: null,
      dispositions: [],
    });
    expect(await actions().record(...as(staff(["incoming.read"])))(received)).toMatchObject({
      error: "forbidden",
    });
    fake.docs.delete("settings/activePeriod");
    expect(await actions().record(...as(secretariat))(received)).toMatchObject({
      error: "refused",
      issues: ["Activate a board period first."],
    });
  });

  it("disposes, forwards, completes bottom-up and archives", async () => {
    const { id } = await recorded();
    const d = actions();
    expect(
      await d.dispose(...as(secretariat))({
        id,
        version: 1,
        toOrgUnitId: "old",
        toUserId: null,
        instruction: "x",
      }),
    ).toMatchObject({
      issues: ["Choose a unit of this board period."],
    });
    expect(
      await d.dispose(...as(secretariat))({
        id,
        version: 1,
        toOrgUnitId: null,
        toUserId: "ghost",
        instruction: "x",
      }),
    ).toMatchObject({
      issues: ["No account with this id."],
    });
    expect(
      await d.dispose(...as(secretariat))({
        id: "missing",
        version: 1,
        toOrgUnitId: "media",
        toUserId: null,
        instruction: "x",
      }),
    ).toMatchObject({
      issues: ["This item does not exist."],
    });
    expect(
      await d.dispose(...as(secretariat))({
        id,
        version: 1,
        toOrgUnitId: "media",
        toUserId: null,
        instruction: "Siapkan balasan",
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    const parent = ((await store().get(id)) as IncomingLetter).dispositions[0]?.id as string;
    expect(
      await d.dispose(...as(secretariat))({
        id,
        version: 2,
        toOrgUnitId: null,
        toUserId: "ari",
        instruction: "Draf",
        parentId: parent,
        dueDate: "2026-11-10",
      }),
    ).toMatchObject({ ok: true });
    const letter = (await store().get(id)) as IncomingLetter;
    expect(letter.dispositions.map((x) => x.status)).toEqual(["in_progress", "waiting"]);
    const child = letter.dispositions[1]?.id as string;
    expect(
      await d.complete(...as(secretariat))({ id, version: 3, dispositionId: parent, response: "" }),
    ).toMatchObject({ error: "refused" });
    expect(await d.archive(...as(secretariat))({ id, version: 3 })).toMatchObject({
      error: "refused",
    });
    expect(
      await d.complete(...as(secretariat))({
        id,
        version: 3,
        dispositionId: child,
        response: "Selesai",
      }),
    ).toMatchObject({ data: { status: "disposed" } });
    expect(
      await d.complete(...as(secretariat))({ id, version: 4, dispositionId: parent, response: "" }),
    ).toMatchObject({ data: { status: "done" } });
    expect(await d.archive(...as(secretariat))({ id, version: 5 })).toMatchObject({ ok: true });
    expect(await d.update(...as(secretariat))({ ...received, id, version: 6 })).toMatchObject({
      issues: ["This letter is archived."],
    });
    const audit = [...fake.docs.keys()].filter((p) => p.startsWith("auditLogs/"));
    expect(audit).toHaveLength(6);
  });

  it("edits the recorded fields, keeps the agenda number", async () => {
    const { id } = await recorded();
    expect(
      await actions().update(...as(secretariat))({
        ...received,
        sender: "KJRI Osaka",
        id,
        version: 1,
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await store().get(id)).toMatchObject({
      sender: "KJRI Osaka",
      agendaNumber: "001/AG/XI/2026",
    });
  });
});

describe("scans (private PDF, checksum on read)", () => {
  const upload = (
    id: string,
    version: number,
    body: Uint8Array,
    name: string | null = encodeURIComponent("Surat KBRI.pdf"),
    principal = secretariat,
  ) =>
    actions().uploadScan(...as(principal))(
      id,
      new Request(`https://admin.test/api/incoming/${id}/scan?version=${version}`, {
        method: "POST",
        body,
        headers: name === null ? {} : { "x-file-name": name },
      }),
    );

  it("stores a PDF privately and serves it only to readers, unchanged", async () => {
    const { id } = await recorded();
    const response = await upload(id, 1, pdf);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ version: 2, name: "Surat KBRI.pdf" });
    const letter = (await store().get(id)) as IncomingLetter;
    expect(letter.scan).toMatchObject({
      path: "letters/incoming/p1/" + id + "_00000001.pdf",
      size: pdf.length,
    });
    const served = await actions().scanFile(id, staff(["incoming.read"]));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-disposition")).toBe('inline; filename="001-AG-XI-2026.pdf"');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(pdf);
    files.set(letter.scan?.path as string, new TextEncoder().encode("%PDF-swapped"));
    expect((await actions().scanFile(id, staff(["incoming.read"]))).status).toBe(404);
    expect((await actions().scanFile("missing", staff(["incoming.read"]))).status).toBe(404);
    expect((await actions().scanFile(id, null)).status).toBe(401);
    expect((await actions().scanFile(id, staff(["incoming.read"], false))).status).toBe(401);
    expect((await actions().scanFile(id, staff(["events.read"]))).status).toBe(403);
  });

  it("refuses other files, oversized bodies, archived letters and strangers", async () => {
    const { id } = await recorded();
    const notPdf = await upload(id, 1, new TextEncoder().encode("<html>"), null);
    expect(notPdf.status).toBe(400);
    expect(await notPdf.json()).toEqual({
      error: "invalid_input",
      message: "Upload the scan as a PDF.",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(pdf);
    expect(await (await upload(id, 1, big)).json()).toMatchObject({
      message: "The scan may be at most 10 MB.",
    });
    expect((await upload(id, 1, pdf, "%E0%A4%A")).status).toBe(201);
    expect((await store().get(id))?.scan?.name).toBe("scan.pdf");
    expect((await upload(id, 1, pdf)).status).toBe(409);
    expect((await upload("missing", 1, pdf)).status).toBe(400);
    expect((await upload(id, 2, pdf, null, staff(["incoming.read"]))).status).toBe(403);
    expect((await upload(id, 2, pdf, null, staff(["incoming.edit"], false))).status).toBe(401);
    await actions().archive(...as(secretariat))({ id, version: 2 });
    expect(await (await upload(id, 3, pdf)).json()).toMatchObject({
      message: "This letter is archived.",
    });
  });
});
