export const QR_MAX_LENGTH = 800;
export const QR_ERROR_CORRECTION = "H";
export const QR_MARGIN = 4;

export const QR_DOWNLOAD_PX = { small: 300, medium: 600, large: 1000 } as const;

export function qrTextProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return "Enter some content first.";
  if (value.length > QR_MAX_LENGTH) return `Use at most ${QR_MAX_LENGTH} characters.`;
  return null;
}

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
