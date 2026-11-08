import type { ShortenerProvider } from "@website/domain/links";

export interface ShortLink {
  id: string;
  version: number;
  provider: ShortenerProvider;
  title: string;
  original: string;
  slug: string;
  shortUrl: string;
  archived: boolean;
  createdAt: string;
}

export const PREFIX = "goppi.id/";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return iso;
  const month = MONTHS[m - 1];
  return `${d} ${month ?? ""} ${y}`;
}
