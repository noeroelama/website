import QRCode from "qrcode";
import { QR_ERROR_CORRECTION, QR_MARGIN, QR_MAX_LENGTH } from "@website/domain/documents";

/** A QR code PNG with the platform's rules (`@website/domain/documents` → qr.ts). */
export async function qrPng(text: string, size: number): Promise<Uint8Array> {
  if (text.length > QR_MAX_LENGTH) throw new Error(`QR content longer than ${QR_MAX_LENGTH}.`);
  const buffer = await QRCode.toBuffer(text, {
    type: "png",
    width: size,
    margin: QR_MARGIN,
    errorCorrectionLevel: QR_ERROR_CORRECTION,
  });
  return new Uint8Array(buffer);
}
