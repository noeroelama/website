import "server-only";
import type { SqlContactReader } from "@website/db/sql";
import { desksOf, type Letter, type LetterType } from "@website/domain/documents";
import type { FinanceRequest } from "@website/domain/finance";
import { messageTo, type Messenger, type SurveySource } from "@website/domain/messaging";
import type { LpjReport } from "@website/domain/programs";
import type { Application, ApplicationStatus } from "@website/domain/recruitment";
import type { PagePermission } from "@website/permissions";

const both = (id: string, en: string) => `${id}\n\n${en}`;
const html = (text: string) =>
  `<p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>")}</p>`;

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
  readonly letterType: (id: string) => Promise<Pick<LetterType, "requiresCoordinator"> | null>;
  readonly webUrl: string;
  readonly adminUrl: string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly poll: (
    uids: readonly string[],
    source: SurveySource,
    sourceId: string,
  ) => Promise<unknown>;
}

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
      if (next.status === "confirmed") await deps.poll([next.userId], "recruitment", next.id);
    });

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

  const lpj = (saved: LpjReport) =>
    safely("lpj", saved.id, async () => {
      const link = `${deps.adminUrl}/lpj/${saved.id}`;
      const key = (uid: string) => `lpj:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const to = (uids: readonly string[], id: string, en: string, extra = "") =>
        tell(
          uids,
          { subject: `LPJ: ${saved.plan.name}`, text: `${both(id, en)}${extra}\n\n${link}` },
          key,
        );
      const desk = async (permission: PagePermission, id: string, en: string) =>
        to(await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }), id, en);
      if (saved.status === "draft" && saved.version === 1) {
        await to(
          saved.pics,
          `Program selesai: tulis LPJ-nya paling lambat ${saved.dueOn}.`,
          `The programme is finished: write its LPJ by ${saved.dueOn}.`,
        );
      } else if (saved.status === "submitted" && !saved.secretariat && !saved.treasurer) {
        await desk(
          "lpj.review_secretariat",
          "LPJ menunggu pemeriksaan.",
          "An LPJ waits for review.",
        );
        await desk("lpj.review_treasurer", "LPJ menunggu pemeriksaan.", "An LPJ waits for review.");
      } else if (saved.status === "submitted" && saved.secretariat && saved.treasurer) {
        await desk("lpj.approve", "LPJ menunggu persetujuan.", "An LPJ waits for your approval.");
      } else if (saved.status === "returned") {
        await to(
          saved.pics,
          "LPJ dikembalikan untuk diperbaiki.",
          "Your LPJ was returned for changes.",
          `\n\n${saved.returnNote ?? ""}`,
        );
      } else if (saved.status === "approved") {
        await to(saved.pics, "LPJ disetujui.", "Your LPJ is approved.");
        await deps.poll(saved.pics, "lpj", saved.id);
      }
    });

  const finance = (saved: FinanceRequest) =>
    safely("finance", saved.id, async () => {
      const link = `${deps.adminUrl}/finance`;
      const subject = `Keuangan / Finance: ${saved.title}`;
      const key = (uid: string) => `finance:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const desk = async (permission: PagePermission, id: string, en: string) =>
        tell(
          await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }),
          { subject, text: `${both(id, en)}\n\n${link}` },
          key,
        );
      const requester = (id: string, en: string, note: string | null) =>
        tell(
          [saved.createdBy],
          { subject, text: `${both(id, en)}${note ? `\n\n${note}` : ""}\n\n${link}` },
          key,
        );
      if (saved.status === "submitted") {
        await desk(
          "finance.review",
          "Pengajuan keuangan menunggu diperiksa bendahara.",
          "A finance request waits for the treasurer's review.",
        );
      } else if (saved.status === "reviewed") {
        await desk(
          "finance.authorize",
          "Pengajuan keuangan menunggu otorisasi koordinator.",
          "A finance request waits for the coordinator's authorisation.",
        );
      } else if (saved.status === "authorized") {
        await desk(
          "finance.pay",
          "Pengajuan keuangan disetujui, menunggu dicairkan.",
          "A finance request is authorised and waits to be paid.",
        );
      } else if (saved.status === "revision") {
        await requester(
          "Pengajuan keuangan dikembalikan untuk diperbaiki.",
          "Your finance request was returned for changes.",
          saved.revisionNote,
        );
      } else if (saved.status === "rejected") {
        await requester(
          "Pengajuan keuangan ditolak.",
          "Your finance request was rejected.",
          saved.rejection?.note ?? null,
        );
      } else if (saved.status === "paid") {
        await requester("Dana telah dicairkan.", "The money has been paid.", null);
        await deps.poll([saved.createdBy], "finance", saved.id);
      }
    });

  return { application, letter, lpj, finance };
}

export type Notices = ReturnType<typeof createNotices>;
