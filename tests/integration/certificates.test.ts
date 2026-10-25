import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFirestoreCertificateStore,
  createFirestoreLetterStore,
  type LetterAudit,
} from "@website/db/firestore";
import {
  DEFAULT_LETTERHEAD,
  passReview,
  signDesk,
  submitForReview,
  type Certificate,
  type Letter,
} from "@website/domain/documents";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { pdfText } from "@website/pdf";
import {
  createCertificateActions,
  createCertificateFileRoute,
} from "../../apps/admin/src/server/certificates";
import { createLetterPdf, type LetterContext } from "../../apps/admin/src/server/letter-pdf";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreLetterStore>[0];
const clock = new Date("2026-11-02T03:00:00Z");
const staff = (permissions: string[], scope: Scope = { type: "global" }): Principal => ({
  kind: "user",
  userId: "sekre",
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const secretariat = staff(["letters.edit", "letters.read"]);
const context = () =>
  Promise.resolve({ actorEmail: "s@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
let events = 0;
const audited: LetterAudit = (_b, _a, _c, next) =>
  ({
    id: `e${(events += 1)}`,
    occurredAt: clock,
    actor: { kind: "system" },
    action: "UPDATE",
    resourceType: "letter",
    resourceId: next.id,
    operationId: "op",
    before: null,
    after: null,
    versionBefore: null,
    versionAfter: next.version,
    revertible: false,
    revertOf: null,
    request: { requestId: "req", ip: null, userAgent: null },
    prevHash: null,
    hash: null,
  }) as never;

const certAudit = (batchLetter: Letter) => audited(null, null, null, batchLetter);

let fake: ReturnType<typeof fakeFirestore>;
const db = () => fake.db as unknown as Db;
const letters = () => createFirestoreLetterStore(db());
const sheets = () => createFirestoreCertificateStore(db());
const actions = () =>
  createCertificateActions({
    certificates: sheets(),
    getLetter: (id) => letters().get(id),
    now: () => clock,
  });
const type = {
  name: "Sertifikat",
  code: "SERT",
  description: "",
  numberFormat: "{nomor}/{jenis}/{kode_kegiatan}/{unit}/{bulan_romawi}/{tahun}",
  numberPadding: 3,
  requiresCoordinator: false,
  requiresRecipient: false,
  contentPublic: true,
  active: true,
  sort: 0,
  version: 1,
  deletedAt: null,
};

async function batch(activityCode: string | null = "lkmm") {
  const created = await letters().create(
    {
      typeId: "sert",
      orgUnitId: "sekjen",
      subject: "LKMM 2026",
      body: "",
      recipient: "",
      place: "Tokyo",
      attachmentNote: "",
      letterDate: "2026-11-02",
      activityCode,
    },
    "author",
    audited,
    clock,
    "certificate",
  );
  return created;
}

const walk = async (letter: Letter) => {
  const store = letters();
  let current = await store.transition(
    letter.id,
    letter.version,
    (l, t) => submitForReview(l, t),
    audited,
    clock,
  );
  current = await store.transition(
    current.id,
    current.version,
    (l, t) => passReview(l, t, "sekre"),
    audited,
    clock,
  );
  current = await store.transition(
    current.id,
    current.version,
    (l, t) => signDesk(l, t, "secretary", "sekjen", clock),
    audited,
    clock,
  );
  return store.issue(current.id, current.version, DEFAULT_LETTERHEAD, audited, clock);
};

beforeEach(() => {
  fake = fakeFirestore();
  fake.docs.set("settings/activePeriod", { periodId: "p1" });
  fake.docs.set("periods/p1", { name: "2026/2027" });
  fake.docs.set("letterTypes/sert", type);
  fake.docs.set("orgUnits/sekjen", {
    periodId: "p1",
    path: [],
    code: "SEKJEN",
    name: "Sekretariat Jenderal",
    active: true,
    deletedAt: null,
  });
  fake.docs.set("users/sekjen", { name: "Rina", email: "rina@example.org" });
});

describe("certificate batches (D5)", () => {
  it("participants get sequences and codes as added; removal never renumbers", async () => {
    const { id } = await batch();
    const added = await actions().add(...as(secretariat))({
      batchId: id,
      text: "ARIF NURWAHID, S.KOM.\tNarasumber\nrina;Juara 1\nRina;Juara 1",
      titleCase: true,
    });
    expect(added).toMatchObject({ ok: true, data: { added: 3 } });
    const list = await sheets().list(id);
    expect(list.map((s) => [s.id, s.seq, s.name, s.note])).toEqual([
      [`${id}_0001`, 1, "Arif Nurwahid, S.KOM.", "Narasumber"],
      [`${id}_0002`, 2, "Rina", "Juara 1"],
      [`${id}_0003`, 3, "Rina", "Juara 1"],
    ]);
    const codeOf = (s: Certificate) => fake.docs.get(`verificationCodes/${s.verificationCode}`);
    expect(codeOf(list[0] as Certificate)).toEqual({
      kind: "certificate",
      letterId: id,
      certificateId: `${id}_0001`,
      periodId: "p1",
    });
    expect(new Set(list.map((s) => s.verificationCode)).size).toBe(3);

    expect(
      await actions().remove(...as(secretariat))({ batchId: id, id: `${id}_0002` }),
    ).toMatchObject({ ok: true });
    expect(codeOf(list[1] as Certificate)).toBeUndefined();
    await actions().add(...as(secretariat))({ batchId: id, text: "Siti", titleCase: false });
    expect((await sheets().list(id)).map((s) => s.seq)).toEqual([1, 3, 4]);
    expect(await sheets().get(`${id}_0004`)).toMatchObject({ name: "Siti", note: null });
    expect(await sheets().get("bad/id")).toBeNull();
    expect(await sheets().get("missing")).toBeNull();
    const entries = [...fake.docs.entries()]
      .filter(([, e]) => (e as { title?: string }).title === "LKMM 2026")
      .filter(([p]) => p.startsWith("auditLogs/"))
      .map(([, e]) => e as { after: unknown; before: unknown });
    expect(entries.map((e) => e.after ?? e.before)).toEqual([
      { participantsAdded: 3 },
      { participant: { seq: 2, name: "Rina" } },
      { participantsAdded: 1 },
    ]);
  });

  it("writes large pastes in chunks; refuses empty lists, other letters and passed batches", async () => {
    const { id } = await batch();
    const text = Array.from({ length: 450 }, (_, i) => `Peserta ${i + 1}`).join("\n");
    expect(
      await actions().add(...as(secretariat))({ batchId: id, text, titleCase: false }),
    ).toMatchObject({
      data: { added: 450 },
    });
    expect(fake.docs.get(`certificateCounters/${id}`)).toEqual({ last: 450 });
    expect(
      await actions().add(...as(secretariat))({ batchId: id, text: " \n ", titleCase: false }),
    ).toMatchObject({
      error: "refused",
      issues: ["No names could be read from that list."],
    });
    expect(
      await actions().add(...as(secretariat))({ batchId: "missing", text: "A", titleCase: false }),
    ).toMatchObject({
      error: "refused",
      issues: ["This certificate batch does not exist."],
    });
    const director = staff(["letters.edit"], { type: "orgUnit", orgUnitId: "media" });
    expect(
      await actions().add(...as(director))({ batchId: id, text: "A", titleCase: false }),
    ).toMatchObject({
      error: "forbidden",
    });
    const issued = await walk((await letters().get(id)) as Letter);
    expect(issued).toMatchObject({
      status: "issued",
      numberFormatted: "001/SERT/LKMM/SEKJEN/XI/2026",
      sheetNumberTemplate: "001.{sheet:3}/SERT/LKMM/SEKJEN/XI/2026",
    });
    expect(
      await actions().add(...as(secretariat))({ batchId: id, text: "Late", titleCase: false }),
    ).toMatchObject({
      issues: ["Participants change only before the secretariat passes it."],
    });
    expect(
      await actions().remove(...as(secretariat))({ batchId: id, id: `${id}_0001` }),
    ).toMatchObject({
      error: "refused",
    });
  });

  it("a batch needs participants and its activity code; removing another batch's sheet is refused", async () => {
    const empty = await batch();
    await expect(walk(empty)).rejects.toThrow("Add the participants first.");
    const noCode = await batch(null);
    await expect(
      letters().transition(
        noCode.id,
        noCode.version,
        (l, t) => submitForReview(l, t),
        audited,
        clock,
      ),
    ).rejects.toThrow("Complete first: Activity code.");
    await actions().add(...as(secretariat))({ batchId: empty.id, text: "A", titleCase: false });
    expect(
      await actions().remove(...as(secretariat))({ batchId: noCode.id, id: `${empty.id}_0001` }),
    ).toMatchObject({
      issues: ["This participant does not exist."],
    });
  });

  it("a taken code is drawn again; five taken draws stop", async () => {
    const { id } = await batch();
    const unlucky = createFirestoreCertificateStore(db(), () => 0);
    fake.docs.set("verificationCodes/AAAAA-AAAAA", { kind: "letter", letterId: "older" });
    await expect(unlucky.add(id, [{ name: "A", note: null }], certAudit, clock)).rejects.toThrow(
      "No free verification code.",
    );
    let draw = 0;
    const second = createFirestoreCertificateStore(db(), () => (draw++ < 10 ? 0 : 1));
    await second.add(id, [{ name: "B", note: null }], certAudit, clock);
    expect((await sheets().list(id))[0]?.verificationCode).toBe("BBBBB-BBBBB");
  });
});

describe("certificate sheets as PDF", () => {
  const files = new Map<string, Uint8Array>();
  const pdf = () =>
    createLetterPdf({
      storage: {
        read: (p) => Promise.resolve(files.get(p) ?? null),
        save: () => Promise.resolve(),
      },
      letters: letters(),
      toPng: (bytes) => Promise.resolve(bytes),
      verification: { host: "verif.ppiasiania.id", webUrl: null },
      uuid: () => "u",
      signatures: { get: () => Promise.resolve(null) },
      signatureKey: () => null,
    });
  const ctx = (): LetterContext => ({
    type: { ...type, id: "sert", createdAt: clock, updatedAt: clock },
    unitName: "Sekretariat Jenderal",
    names: new Map([["sekjen", "Rina"]]),
    letterhead: DEFAULT_LETTERHEAD,
  });

  it("drafts print no number or QR; issued sheets print their number and own code", async () => {
    const { id } = await batch();
    await actions().add(...as(secretariat))({
      batchId: id,
      text: "Arif;Narasumber",
      titleCase: false,
    });
    const sheet = (await sheets().list(id))[0] as Certificate;
    const draft = await pdf().renderCertificate((await letters().get(id)) as Letter, sheet, ctx());
    expect(await pdfText(draft)).toContain("Nomor diberikan saat angkatan diterbitkan");
    const issued = await walk((await letters().get(id)) as Letter);
    const text = await pdfText(await pdf().renderCertificate(issued, sheet, ctx()));
    expect(text).toContain("001.001/SERT/LKMM/SEKJEN/XI/2026");
    expect(text).toContain(sheet.verificationCode);
    expect(text).toContain("Tokyo, 2 November 2026");
    const undated = await pdf().renderCertificate({ ...issued, letterDate: null }, sheet, ctx());
    expect(await pdfText(undated)).not.toContain("Tokyo,");
  });

  const route = (batchLetter: Letter | null, sheet: Certificate | null, fail = false) => {
    const logError = vi.fn();
    const handler = createCertificateFileRoute({
      getLetter: () => Promise.resolve(batchLetter),
      getSheet: () => Promise.resolve(sheet),
      load: (l) => Promise.resolve(l.typeId === "gone" ? null : { context: ctx() }),
      pdf: {
        renderCertificate: () =>
          fail ? Promise.reject(new Error("boom")) : Promise.resolve(new Uint8Array([37, 80])),
      },
      logError,
    });
    return { handler, logError };
  };

  it("serves a sheet to staff in scope; hides it from others; never leaks errors", async () => {
    const { id } = await batch();
    await actions().add(...as(secretariat))({ batchId: id, text: "Arif", titleCase: false });
    const letter = (await letters().get(id)) as Letter;
    const sheet = (await sheets().list(id))[0] as Certificate;
    const ok = await route(letter, sheet).handler(id, sheet.id, secretariat);
    expect([ok.status, ok.headers.get("content-disposition")]).toEqual([
      200,
      'inline; filename="sertifikat-001.pdf"',
    ]);
    expect((await route(letter, sheet).handler(id, sheet.id, null)).status).toBe(401);
    expect((await route(letter, sheet).handler(id, sheet.id, staff([]))).status).toBe(403);
    expect((await route(letter, sheet).handler(id, sheet.id, staff(["events.read"]))).status).toBe(
      404,
    );
    expect((await route(null, sheet).handler(id, sheet.id, secretariat)).status).toBe(404);
    expect(
      (await route({ ...letter, deletedAt: clock }, sheet).handler(id, sheet.id, secretariat))
        .status,
    ).toBe(404);
    expect(
      (await route(letter, { ...sheet, batchId: "other" }).handler(id, sheet.id, secretariat))
        .status,
    ).toBe(404);
    expect(
      (await route({ ...letter, typeId: "gone" }, sheet).handler(id, sheet.id, secretariat)).status,
    ).toBe(404);
    const failing = route(letter, sheet, true);
    expect((await failing.handler(id, sheet.id, secretariat)).status).toBe(500);
    expect(failing.logError).toHaveBeenCalledWith("certificate pdf failed", {
      batchId: id,
      sheetId: sheet.id,
      error: "Error: boom",
    });
  });
});
