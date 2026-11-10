import { randomUUID } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import {
  assertCapacity,
  DEFAULT_ZOOM_SETTINGS,
  utcDays,
  type HeldSlot,
  type RecordingFile,
  type ZoomRequest,
  type ZoomSettings,
  type ZoomStatus,
} from "@website/domain/zoom";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { toDate } from "./slugged";
import type { Database, Transaction } from "./store";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type ZoomRequestFields = Omit<ZoomRequest, Meta>;

export type ZoomAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: ZoomRequest | null,
  next: ZoomRequest,
) => AuditEvent;

const toRequest = (id: string, data: Record<string, unknown>): ZoomRequest => ({
  id,
  topic: data["topic"] as string,
  startsAt: toDate(data["startsAt"]) as Date,
  endsAt: toDate(data["endsAt"]) as Date,
  timeZone: data["timeZone"] as string,
  passcode: data["passcode"] as string,
  joinBeforeHostMinutes: data["joinBeforeHostMinutes"] as number,
  meetingId: (data["meetingId"] as string | null) ?? null,
  requestedBy: data["requestedBy"] as string,
  orgUnitId: (data["orgUnitId"] as string | null) ?? null,
  orgUnitPath: data["orgUnitPath"] as string[],
  status: data["status"] as ZoomStatus,
  decidedBy: (data["decidedBy"] as string | null) ?? null,
  decisionNote: (data["decisionNote"] as string | null) ?? null,
  zoomMeetingId: (data["zoomMeetingId"] as string | null) ?? null,
  joinUrl: (data["joinUrl"] as string | null) ?? null,
  shortUrl: (data["shortUrl"] as string | null) ?? null,
  roomError: (data["roomError"] as string | null) ?? null,
  closedAt: toDate(data["closedAt"]),
  recordingUuids: data["recordingUuids"] as string[],
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

const sessionId = (uuid: string) => Buffer.from(uuid).toString("hex");

const toFile = (id: string, data: Record<string, unknown>): RecordingFile => ({
  ...(data as unknown as RecordingFile),
  id,
  updatedAt: toDate(data["updatedAt"]) as Date,
});

export const zoomSnapshot = (r: ZoomRequestFields): Snapshot => ({
  topic: r.topic,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt.toISOString(),
  status: r.status,
  decisionNote: r.decisionNote,
  joinUrl: r.joinUrl,
});

const toSlots = (value: unknown): HeldSlot[] =>
  ((value ?? []) as Array<Record<string, unknown>>).map((s) => ({
    id: s["id"] as string,
    startsAt: toDate(s["startsAt"]) as Date,
    endsAt: toDate(s["endsAt"]) as Date,
  }));

export function createSqlZoomStore(db: Database) {
  const requests = db.collection("zoomRequests");
  const capacity = db.collection("zoomCapacity");
  const settingsRef = db.collection("settings").doc("zoom");
  const sessions = db.collection("recordingSessions");
  const recordingFiles = db.collection("recordingFiles");
  const audit = createSqlAuditWriter(db);
  const read = (id: string, data: unknown) => toRequest(id, data as Record<string, unknown>);

  const parseSettings = (
    data: Record<string, unknown> | undefined,
  ): { settings: ZoomSettings; version: number | null } => {
    const { version = null, ...settings } = data ?? {};
    return {
      settings: { ...DEFAULT_ZOOM_SETTINGS, ...(settings as Partial<ZoomSettings>) },
      version: version as number | null,
    };
  };
  const readSettings = async (tx: Transaction) => parseSettings((await tx.get(settingsRef)).data());

  return {
    readSettings: async () => parseSettings((await settingsRef.get()).data()),

    async saveSettings(
      settings: ZoomSettings,
      expectedVersion: number | null,
      auditFor: (before: Snapshot, after: Snapshot, version: number) => AuditEvent,
    ): Promise<number> {
      return db.runTransaction(async (tx) => {
        const current = await readSettings(tx);
        if (current.version !== expectedVersion)
          throw new ConcurrencyConflictError("zoom settings changed");
        const version = (current.version ?? 0) + 1;
        const log = await audit.begin(tx);
        tx.set(settingsRef, { ...settings, version });
        const visible = (s: ZoomSettings) => ({
          ...s,
          hostKeyEncrypted: s.hostKeyEncrypted ? "(set)" : null,
        });
        log.append(auditFor(visible(current.settings), visible(settings), version));
        return version;
      });
    },

    async get(id: string): Promise<ZoomRequest | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await requests.doc(id).get();
      return snapshot.exists ? read(id, snapshot.data()) : null;
    },

    async listBetween(from: Date, to: Date): Promise<ZoomRequest[]> {
      const snapshot = await requests
        .where("startsAt", ">=", from)
        .where("startsAt", "<=", to)
        .get();
      return snapshot.docs
        .map((doc) => read(doc.id, doc.data()))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    },

    async addSession(uuid: string, bookingId: string, now: Date): Promise<void> {
      const ref = sessions.doc(sessionId(uuid));
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, { uuid, bookingId, listedAt: null, trashedAt: null, createdAt: now });
      });
    },

    async unlistedSessions(
      limit: number,
    ): Promise<Array<{ uuid: string; bookingId: string; createdAt: Date }>> {
      const snapshot = await sessions.where("listedAt", "==", null).limit(limit).get();
      return snapshot.docs.map((d) => ({
        uuid: d.get("uuid") as string,
        bookingId: d.get("bookingId") as string,
        createdAt: toDate(d.get("createdAt")) ?? new Date(0),
      }));
    },

    /** Stores newly seen files; `complete` marks the session listed so it is not asked again. */
    async listSession(
      uuid: string,
      files: readonly RecordingFile[],
      now: Date,
      complete = true,
    ): Promise<void> {
      const ref = sessions.doc(sessionId(uuid));
      await db.runTransaction(async (tx) => {
        const existing = await Promise.all(
          files.map((f) => tx.get(recordingFiles.doc(safeId.parse(f.id)))),
        );
        files.forEach((file, i) => {
          if (!existing[i]?.exists) tx.set(recordingFiles.doc(safeId.parse(file.id)), { ...file });
        });
        if (complete) tx.update(ref, { listedAt: now });
      });
    },

    async sessionListed(uuid: string): Promise<boolean> {
      return Boolean((await sessions.doc(sessionId(uuid)).get()).get("listedAt"));
    },

    async markSessionTrashed(uuid: string, now: Date): Promise<void> {
      const ref = sessions.doc(sessionId(uuid));
      await db.runTransaction(async (tx) => {
        tx.update(ref, { trashedAt: now });
        return Promise.resolve();
      });
    },

    async sessionTrashed(uuid: string): Promise<boolean> {
      return Boolean((await sessions.doc(sessionId(uuid)).get()).get("trashedAt"));
    },

    async nextFile(): Promise<RecordingFile | null> {
      for (const status of ["uploading", "pending"] as const) {
        const snapshot = await recordingFiles
          .where("status", "==", status)
          .orderBy("updatedAt")
          .limit(1)
          .get();
        const doc = snapshot.docs[0];
        if (doc) return toFile(doc.id, doc.data());
      }
      return null;
    },

    async saveFile(file: RecordingFile): Promise<void> {
      await recordingFiles.doc(safeId.parse(file.id)).set({ ...file });
    },

    async filesForBookings(bookingIds: readonly string[]): Promise<RecordingFile[]> {
      if (bookingIds.length === 0) return [];
      const found: RecordingFile[] = [];
      for (let i = 0; i < bookingIds.length; i += 30) {
        const snapshot = await recordingFiles
          .where("bookingId", "in", bookingIds.slice(i, i + 30))
          .get();
        found.push(...snapshot.docs.map((d) => toFile(d.id, d.data())));
      }
      return found;
    },

    async findByZoomMeetingId(zoomMeetingId: string): Promise<ZoomRequest | null> {
      const snapshot = await requests.where("zoomMeetingId", "==", zoomMeetingId).limit(1).get();
      const doc = snapshot.docs[0];
      return doc ? read(doc.id, doc.data()) : null;
    },

    async withoutRoom(limit: number): Promise<ZoomRequest[]> {
      const snapshot = await requests
        .where("status", "==", "approved")
        .where("joinUrl", "==", null)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => read(doc.id, doc.data()));
    },

    write(
      id: string | null,
      expectedVersion: number | null,
      build: (current: ZoomRequest | null, settings: ZoomSettings) => ZoomRequestFields,
      auditFor: ZoomAudit,
      now: Date,
    ): Promise<ZoomRequest> {
      const ref = requests.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = id === null ? null : await tx.get(ref);
        if (id !== null && !snapshot?.exists)
          throw new RuleViolationError("This booking does not exist.");
        const current = snapshot?.exists ? read(ref.id, snapshot.data()) : null;
        if ((current?.version ?? null) !== expectedVersion)
          throw new ConcurrencyConflictError("zoomRequests version changed");
        const { settings } = await readSettings(tx);
        const fields = build(current, settings);
        const next: ZoomRequest = {
          ...fields,
          id: ref.id,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        const was = current?.status === "approved";
        const is = next.status === "approved";
        const slot = { id: next.id, startsAt: next.startsAt, endsAt: next.endsAt };
        const days = was !== is ? utcDays(slot.startsAt, slot.endsAt) : [];
        const dayDocs = [];
        for (const day of days) {
          const doc = await tx.get(capacity.doc(day));
          const held = toSlots(doc.get("slots"));
          if (is) assertCapacity(held, slot, settings);
          dayDocs.push({ day, held });
        }
        const log = await audit.begin(tx);
        tx.set(ref, { ...next });
        for (const { day, held } of dayDocs) {
          const others = held.filter((h) => h.id !== slot.id);
          tx.set(capacity.doc(day), { slots: is ? [...others, slot] : others });
        }
        log.append(auditFor(current && zoomSnapshot(current), zoomSnapshot(next), current, next));
        return next;
      });
    },
  };
}

export type SqlZoomStore = ReturnType<typeof createSqlZoomStore>;
