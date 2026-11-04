import type { ShortenerProvider } from "@website/domain/links";

/** A short link as the Tools page lists it (`linkRow` in src/server/links.ts). */
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

/** The primary provider's prefix in the slug field (s.id is only the fallback). */
export const PREFIX = "goppi.id/";

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date (2026-05-11) → "11 May 2026" for the table cells. */
export function formatDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return iso;
  const month = MONTHS[m - 1];
  return `${d} ${month ?? ""} ${y}`;
}
