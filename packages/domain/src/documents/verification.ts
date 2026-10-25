import { sheetNumber, type Certificate } from "./certificates";
import type { Letter } from "./letters";

/**
 * Public verification of documents (D7, PPIDK `VerifikasiController` + `Penyamaran`). Anyone
 * holding a printed letter opens its code without signing in and compares the paper with what
 * is on record. The page never says "signature valid" or "document intact": the letter carries
 * no cryptographic signature.
 */

/** "Arif Nurwahid" → "A*** N***": always three stars, so the name's length does not leak. */
export function maskName(name: string): string | null {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return words.length > 0 ? words.map((w) => `${Array.from(w)[0]}***`).join(" ") : null;
}

/** The typed name equals the printed one, ignoring case and extra spaces (not spelling). */
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
  /**
   * shown: the body is on the page; changed: the stored text no longer matches the digest frozen
   * at issue (shown to nobody); needs_name: type the recipient's name; none: gated without a
   * recipient to type.
   */
  readonly content: "shown" | "changed" | "needs_name" | "none";
  /** A name was typed and it did not match. */
  readonly wrongName: boolean;
  /** The sanitized body, only when `content` is "shown". */
  readonly bodyHtml: string | null;
  /** The archived PDF may be downloaded (content shown, not cancelled, archived). */
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

/** What may be shown for an issued or cancelled letter. */
export function letterVerification(input: {
  readonly code: string;
  readonly letter: Letter;
  readonly typeName: string;
  readonly contentPublic: boolean;
  readonly unitName: string;
  readonly periodName: string | null;
  /** null = issued before digests existed (imported): not the same as "changed". */
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
  /** The whole batch was cancelled: every sheet of it says so. */
  readonly cancelled: boolean;
  /** The sheet's number (`007.037/SERT/...`). */
  readonly number: string;
  /** Printed on the sheet in full: the holder checks it against the paper. */
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

/** What may be shown for a sheet of an issued or cancelled certificate batch (D5). */
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
