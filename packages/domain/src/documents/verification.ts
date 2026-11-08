import { sheetNumber, type Certificate } from "./certificates";
import type { Letter } from "./letters";

export function maskName(name: string): string | null {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return words.length > 0 ? words.map((w) => `${Array.from(w)[0]}***`).join(" ") : null;
}

export function namesMatch(printed: string, typed: string | null): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
  return norm(printed) !== "" && typed !== null && norm(printed) === norm(typed);
}

export interface PublicSigner {
  readonly desk: string;
  readonly name: string;
  readonly position: string | null;
  readonly period: string | null;
  readonly signedAt: Date;
}

export interface LetterVerification {
  readonly kind: "letter";
  readonly code: string;
  readonly cancelled: boolean;
  readonly number: string;
  readonly typeName: string;
  readonly subject: string;
  readonly recipientMasked: string | null;
  readonly letterDate: string | null;
  readonly unitName: string;
  readonly periodName: string | null;
  readonly signers: readonly PublicSigner[];
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly content: "shown" | "changed" | "needs_name" | "none";
  readonly wrongName: boolean;
  readonly bodyHtml: string | null;
  readonly canDownload: boolean;
}

const publicSigners = (letter: Letter): PublicSigner[] =>
  letter.signers.map((s) => ({
    desk: s.desk,
    name: s.name,
    position: s.position,
    period: s.period,
    signedAt: s.at,
  }));

export function letterVerification(input: {
  readonly code: string;
  readonly letter: Letter;
  readonly typeName: string;
  readonly contentPublic: boolean;
  readonly unitName: string;
  readonly periodName: string | null;
  readonly digestMatches: boolean | null;
  readonly typedName: string | null;
}): LetterVerification {
  const { letter } = input;
  const open =
    input.digestMatches !== false &&
    (input.contentPublic || namesMatch(letter.recipient, input.typedName));
  const content =
    input.digestMatches === false
      ? "changed"
      : open
        ? "shown"
        : letter.recipient.trim()
          ? "needs_name"
          : "none";
  return {
    kind: "letter",
    code: input.code,
    cancelled: letter.status === "cancelled",
    number: letter.numberFormatted ?? "",
    typeName: input.typeName,
    subject: letter.subject,
    recipientMasked: maskName(letter.recipient),
    letterDate: letter.letterDate,
    unitName: input.unitName,
    periodName: input.periodName,
    signers: publicSigners(letter),
    cancelledAt: letter.cancelledAt,
    cancelReason: letter.cancelReason,
    content,
    wrongName: input.typedName !== null && input.typedName.trim() !== "" && !open,
    bodyHtml: content === "shown" ? letter.body : null,
    canDownload: content === "shown" && letter.status !== "cancelled" && letter.archive !== null,
  };
}

export interface CertificateVerification {
  readonly kind: "certificate";
  readonly code: string;
  readonly cancelled: boolean;
  readonly number: string;
  readonly holderName: string;
  readonly note: string | null;
  readonly activity: string;
  readonly letterDate: string | null;
  readonly unitName: string;
  readonly periodName: string | null;
  readonly signers: readonly PublicSigner[];
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
}

export function certificateVerification(input: {
  readonly code: string;
  readonly batch: Letter;
  readonly certificate: Certificate;
  readonly unitName: string;
  readonly periodName: string | null;
}): CertificateVerification {
  const { batch, certificate } = input;
  return {
    kind: "certificate",
    code: input.code,
    cancelled: batch.status === "cancelled",
    number: sheetNumber(batch.sheetNumberTemplate, certificate.seq) ?? "",
    holderName: certificate.name,
    note: certificate.note,
    activity: batch.subject,
    letterDate: batch.letterDate,
    unitName: input.unitName,
    periodName: input.periodName,
    signers: publicSigners(batch),
    cancelledAt: batch.cancelledAt,
    cancelReason: batch.cancelReason,
  };
}
