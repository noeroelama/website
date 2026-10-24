import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  planVersion,
  versionDocId,
  type Form,
  type FormStatus,
  type FormUsage,
  type FormVersion,
  type Question,
  type VersionPlan,
} from "@website/domain/forms";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { getDocumentsByIds } from "./batch";
import { createSluggedStore, toDate } from "./slugged";

export type FormFields = Omit<Form, "id" | "version" | "createdAt" | "updatedAt">;
/** What the form editor saves: the settings and the questions of the current version. */
export type FormSettings = Pick<Form, "title" | "description" | "usage" | "opensAt" | "closesAt">;

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toForm(id: string, data: Record<string, unknown>): Form {
  return {
    id,
    title: data["title"] as string,
    description: data["description"] as string,
    usage: data["usage"] as FormUsage,
    status: data["status"] as FormStatus,
    publicToken: (data["publicToken"] as string | null | undefined) ?? null,
    currentVersion: data["currentVersion"] as number,
    opensAt: toDate(data["opensAt"]),
    closesAt: toDate(data["closesAt"]),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

function toVersion(data: Record<string, unknown>): FormVersion {
  return {
    formId: data["formId"] as string,
    number: data["number"] as number,
    questions: data["questions"] as Question[],
    answered: data["answered"] as boolean,
    createdAt: toDate(data["createdAt"]) as Date,
  };
}

/** Audit snapshot = the editable fields (dates as ISO strings, also stored that way). */
export function formSnapshot(f: FormFields): Snapshot {
  return {
    title: f.title,
    description: f.description,
    usage: f.usage,
    status: f.status,
    currentVersion: f.currentVersion,
    opensAt: iso(f.opensAt),
    closesAt: iso(f.closesAt),
  };
}

/** The questions as written into the audit entry of a save (labels only, no answers). */
const questionSummary = (questions: readonly Question[]) =>
  questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: q.required }));

export type FormAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Form | null,
  next: Form,
) => AuditEvent;

/**
 * `forms/{id}` (soft delete) and `formVersions/{formId}_{n}` (questions; never deleted).
 * The public token is stored beside the snapshot so a revert never changes the public URL.
 */
export function createFirestoreFormStore(db: Firestore) {
  const store = createSluggedStore<Form>(db, {
    collection: "forms",
    slug: null,
    fromDoc: toForm,
    snapshot: formSnapshot,
    fixed: (f) => ({ publicToken: f.publicToken }),
  });
  const versions = db.collection("formVersions");
  const auditLog = createFirestoreAuditWriter(db);
  const versionRef = (formId: string, n: number) => versions.doc(versionDocId(formId, n));

  return {
    get: store.get,
    write: store.write,

    /** Every form that is not deleted, last changed first. */
    async listForAdmin(): Promise<Form[]> {
      const snapshot = await store.docs.orderBy("updatedAt", "desc").get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data())).filter((f) => !f.deletedAt);
    },

    async getVersion(formId: string, n: number): Promise<FormVersion | null> {
      if (!safeId.safeParse(formId).success) return null;
      const snapshot = await versionRef(formId, n).get();
      return snapshot.exists ? toVersion(snapshot.data() as Record<string, unknown>) : null;
    },

    /** The current version of each form (one batched read), by form id. */
    async currentVersions(forms: readonly Form[]): Promise<Map<string, FormVersion>> {
      const found = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "formVersions",
        forms.map((f) => versionDocId(f.id, f.currentVersion)),
      );
      const result = new Map<string, FormVersion>();
      for (const data of found.values()) {
        if (data) result.set(data["formId"] as string, toVersion(data));
      }
      return result;
    },

    /** Every version of a form, oldest first. */
    async listVersions(formId: string): Promise<FormVersion[]> {
      const snapshot = await versions.where("formId", "==", safeId.parse(formId)).get();
      return snapshot.docs.map((doc) => toVersion(doc.data())).sort((a, b) => a.number - b.number);
    },

    /**
     * Create or edit, ONE transaction: the form and its current version are read; the freezing
     * rule (planVersion) decides whether the questions are written in place or as version n+1;
     * `check` may refuse (e.g. a published form gaining a file question); the form, the version
     * and the audit entry are written together.
     */
    save(
      id: string | null,
      expectedVersion: number | null,
      settings: FormSettings,
      questions: readonly Question[],
      check: (current: Form | null, questions: readonly Question[]) => void,
      audit: FormAudit,
      now: Date,
    ): Promise<{ form: Form; plan: VersionPlan }> {
      const ref = store.docs.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = id === null ? null : await tx.get(ref);
        if (id !== null && !snapshot?.exists) {
          throw new RuleViolationError("This item does not exist.");
        }
        const current = snapshot?.exists ? store.read(ref.id, snapshot.data()) : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("forms version changed");
        }
        if (current?.deletedAt) throw new RuleViolationError("This item is in the trash.");
        if (current && current.usage !== settings.usage && current.status !== "draft") {
          throw new RuleViolationError("Where a form is used changes only while it is a draft.");
        }
        check(current, questions);
        const latest = current
          ? await tx.get(versionRef(current.id, current.currentVersion))
          : null;
        const plan = planVersion(
          latest?.exists ? toVersion(latest.data() as Record<string, unknown>) : null,
          questions,
        );
        const next: Form = {
          ...settings,
          id: ref.id,
          status: current?.status ?? "draft",
          publicToken: current?.publicToken ?? null,
          currentVersion: plan.number,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, {
          ...formSnapshot(next),
          publicToken: next.publicToken,
          version: next.version,
          createdAt: next.createdAt,
          updatedAt: now,
          deletedAt: null,
        });
        if (plan.write === "create") {
          tx.create(versionRef(ref.id, plan.number), {
            formId: ref.id,
            number: plan.number,
            questions,
            answered: false,
            createdAt: now,
          });
        } else if (plan.write === "overwrite") {
          tx.update(versionRef(ref.id, plan.number), { questions });
        }
        const questionsAfter =
          plan.write === "none" ? {} : { questions: questionSummary(questions) };
        log.append(
          audit(
            current && formSnapshot(current),
            { ...formSnapshot(next), ...questionsAfter },
            current,
            next,
          ),
        );
        return { form: next, plan };
      });
    },
  };
}

export type FirestoreFormStore = ReturnType<typeof createFirestoreFormStore>;
