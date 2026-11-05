import { notFound } from "next/navigation";
import { isEditable, sheetNumber } from "@website/domain/documents";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { ParticipantsPage } from "@/components/participants-page";
import { LETTER_STATUS_LABELS, label } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { adminReads, certificateSending } from "@/server/wiring";
import { CertificateSendPanel } from "@/components/certificate-send-panel";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Letters → a certificate batch's participants (D5): paste, remove, open each sheet. */
export default async function ParticipantsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/letters/${id}/participants`, "letters.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!safeId.safeParse(id).success) notFound();
  const batch = await adminReads.getLetter(id);
  const scope = { orgUnitPath: batch?.orgUnitPath ?? [] };
  if (
    !batch ||
    batch.deletedAt ||
    batch.source !== "certificate" ||
    !can(viewer.principal, "letters.read", scope)
  ) {
    notFound();
  }
  const sheets = await adminReads.listCertificates(batch.id);
  const canSend = batch.status === "issued" && can(viewer.principal, "letters.edit", scope);
  const progress = canSend ? await certificateSending().progress(batch.id) : null;
  return (
    <ParticipantsPage
      batch={{
        id: batch.id,
        subject: batch.subject,
        number: batch.numberFormatted,
        statusLabel: label(LETTER_STATUS_LABELS, batch.status),
      }}
      sheets={sheets.map((s) => ({
        id: s.id,
        seq: s.seq,
        name: s.name,
        note: s.note,
        number: sheetNumber(batch.sheetNumberTemplate, s.seq),
        code: batch.verificationCode ? s.verificationCode : null,
        hasEmail: s.emailHash !== null,
      }))}
      canEdit={isEditable(batch) && can(viewer.principal, "letters.edit", scope)}
      send={progress && <CertificateSendPanel batchId={batch.id} progress={progress} />}
    />
  );
}
