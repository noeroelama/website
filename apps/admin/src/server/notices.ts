import "server-only";
import type { SqlContactReader } from "@website/db/sql";
import { desksOf, type Letter, type LetterType } from "@website/domain/documents";
import { messageTo, type Messenger } from "@website/domain/messaging";
import type { Application, ApplicationStatus } from "@website/domain/recruitment";
import type { PagePermission } from "@website/permissions";

/** Text in both languages, as the other system messages (invites). */
const both = (id: string, en: string) => `${id}\n\n${en}`;
const html = (text: string) =>
  `<p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>")}</p>`;

/** What the applicant is told when a desk moves their application (J2). */
const APPLICATION_NOTICES: Partial<Record<ApplicationStatus, readonly [string, string]>> = {
  revision: [
    "Panitia meminta perbaikan pada lamaranmu. Buka halaman lamaran untuk melihat permintaannya.",
    "The committee asks you to revise your application. Open the application page to see what.",
  ],
  admin_rejected: [
    "Lamaranmu belum lolos seleksi berkas. Terima kasih atas minatmu.",
    "Your application did not pass the document check. Thank you for your interest.",
  ],
  interview: [
    "Lamaranmu lolos seleksi berkas. Pilih jadwal wawancara di halaman lamaran.",
    "Your application passed the document check. Pick an interview time on the application page.",
  ],
  offered: [
    "Kamu mendapat tawaran posisi. Terima atau tolak sebelum batas waktunya di halaman lamaran.",
    "You have a placement offer. Accept or decline it before it expires on the application page.",
  ],
  rejected: [
    "Lamaranmu belum berhasil kali ini. Terima kasih atas minatmu.",
    "Your application was not successful this time. Thank you for your interest.",
  ],
  approved: [
    "Penempatanmu disetujui. Unggah pakta integritas yang sudah ditandatangani di halaman lamaran.",
    "Your placement is approved. Upload the signed integrity pact on the application page.",
  ],
  confirmed: [
    "Selamat, kamu resmi dilantik sebagai pengurus.",
    "Congratulations, you are now confirmed as an officer.",
  ],
};

type Content = { subject: string; text: string };

export interface NoticeDeps {
  readonly contacts: Pick<SqlContactReader, "contacts" | "holders">;
  readonly send: Messenger["send"];
  /** The letter's type (which signing desks it has). */
  readonly letterType: (id: string) => Promise<Pick<LetterType, "requiresCoordinator"> | null>;
  readonly webUrl: string;
  readonly adminUrl: string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}

/**
 * Notification sources (J2): recruitment decisions to the applicant and letter desk requests to
 * the desk holders, each on their own channel (WhatsApp when a number exists, else e-mail).
 * Called AFTER the action's transaction committed; a failure is logged, never thrown (the
 * decision already stands, and failed messages wait on the Email page).
 */
export function createNotices(deps: NoticeDeps) {
  async function tell(uids: readonly string[], content: Content, key: (uid: string) => string) {
    const contacts = await deps.contacts.contacts(uids);
    for (const uid of uids) {
      await deps.send(
        messageTo(contacts.get(uid) ?? null, { ...content, html: html(content.text) }),
        key(uid),
      );
    }
  }

  const safely = async (what: string, id: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      deps.logError("notice failed", { what, id, error: String(error) });
    }
  };

  /** The applicant, after a committee decision. */
  const application = (next: Application, recruitmentTitle: string) =>
    safely("application", next.id, async () => {
      const notice = APPLICATION_NOTICES[next.status];
      if (!notice) return;
      const note = next.status === "approved" && next.pactNote ? `\n\n${next.pactNote}` : "";
      const link = `${deps.webUrl}/recruitment/${next.recruitmentId}`;
      await tell(
        [next.userId],
        {
          subject: `Oprec: ${recruitmentTitle}`,
          text: `${both(notice[0], notice[1])}${note}\n\n${link}`,
        },
        () => `recruitment:${next.id}:${next.status}:${next.version}`,
      );
    });

  /** Whoever must act next on the letter (its desk holders in the letter's unit, or the author). */
  const letter = (saved: Letter) =>
    safely("letter", saved.id, async () => {
      const link = `${deps.adminUrl}/letters`;
      const key = (uid: string) => `letter:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const desk = async (permission: PagePermission, id: string, en: string) =>
        tell(
          await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }),
          { subject: `Surat / Letter: ${saved.subject}`, text: `${both(id, en)}\n\n${link}` },
          key,
        );
      if (saved.status === "review") {
        await desk("letters.review", "Surat menunggu koreksi.", "A letter waits for review.");
      } else if (saved.status === "corrected" && !saved.secretary && !saved.coordinator) {
        // Just passed review: every desk still to sign.
        const type = await deps.letterType(saved.typeId);
        for (const d of desksOf(type ?? { requiresCoordinator: false })) {
          await desk(
            d === "secretary" ? "letters.sign" : "letters.sign_coordinator",
            "Surat menunggu tanda tangan.",
            "A letter waits for your signature.",
          );
        }
      } else if (saved.status === "approved") {
        await desk("letters.issue", "Surat siap diterbitkan.", "A letter is ready to be issued.");
      } else if (saved.status === "draft" && saved.reviewNote) {
        await tell(
          [saved.createdBy],
          {
            subject: `Surat / Letter: ${saved.subject}`,
            text: `${both("Surat dikembalikan untuk diperbaiki.", "Your letter was returned for changes.")}\n\n${saved.reviewNote}\n\n${link}`,
          },
          key,
        );
      }
    });

  return { application, letter };
}

export type Notices = ReturnType<typeof createNotices>;
