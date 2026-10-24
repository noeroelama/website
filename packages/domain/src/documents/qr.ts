/**
 * One set of QR rules for the whole platform (D8, from PPIDK `PembuatQr`): the Tools page, letter
 * and certificate PDFs and (later) attendance codes all use them, so no QR is less robust than
 * another once it is printed, photocopied or photographed.
 */

/** Beyond ~800 characters a high-correction code is too dense to scan from paper. */
export const QR_MAX_LENGTH = 800;
/** High error correction (~30%): survives photocopies and a centre logo. */
export const QR_ERROR_CORRECTION = "H";
/** Quiet zone in modules (the QR standard asks for 4; less fails on cut prints). */
export const QR_MARGIN = 4;

/** Download sizes in pixels (the on-screen preview is smaller). */
export const QR_DOWNLOAD_PX = { small: 300, medium: 600, large: 1000 } as const;

/** Why `text` cannot become a QR code, or null. */
export function qrTextProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Enter some content first.";
  if (value.length > QR_MAX_LENGTH) return `Use at most ${QR_MAX_LENGTH} characters.`;
  return null;
}

/**
 * Where the optional centre logo goes on a `size`-pixel PNG: an OPAQUE plate in the QR's light
 * colour (a transparent logo would otherwise merge with the dark modules) covering 22% of the
 * width (under 5% of the area, which high correction recovers), the logo inset by 10% of the
 * plate. SVG downloads never get a logo (it would be a raster inside the vector file).
 */
export function qrLogoPlate(size: number) {
  const plate = Math.round(size * 0.22);
  const inset = Math.round(plate * 0.1);
  const offset = Math.round((size - plate) / 2);
  return {
    x: offset,
    y: offset,
    size: plate,
    logo: { x: offset + inset, y: offset + inset, size: plate - 2 * inset },
  };
}
