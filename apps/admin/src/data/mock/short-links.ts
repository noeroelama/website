/**
 * Short-link mock data for the Tools page (URL shortener). Static, client-side only — there is
 * no shortener backend yet (decided earlier); the page manages its own state on top of this seed.
 */

export interface ShortLink {
  id: string;
  title: string;
  original: string;
  slug: string;
  createdAt: string;
  clicks: number;
}

export const PREFIX = "goppi.id/";

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function daysAgo(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 12) - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

export const INITIAL_LINKS: ShortLink[] = [
  { id: "l1", title: "PPIDK Asiania News", original: "https://ppidk-asiania.or.id/kabar/berita-2026", slug: "berita2026", createdAt: daysAgo(4), clicks: 1240 },
  { id: "l2", title: "Event This Month", original: "https://ppidk-asiania.or.id/agenda/event-bulan-ini", slug: "agenda", createdAt: daysAgo(7), clicks: 812 },
  { id: "l3", title: "Activity Gallery", original: "https://ppidk-asiania.or.id/arsip/galeri-kegiatan", slug: "galeri", createdAt: daysAgo(14), clicks: 456 },
  { id: "l4", title: "Annual Report", original: "https://ppidk-asiania.or.id/dokumen/laporan-tahunan", slug: "laporan", createdAt: daysAgo(23), clicks: 233 },
  { id: "l5", title: "Public Information", original: "https://ppidk-asiania.or.id/layanan/informasi-publik", slug: "informasi", createdAt: daysAgo(30), clicks: 190 },
  { id: "l6", title: "Legal Documents", original: "https://ppidk-asiania.or.id/dokumen/regulasi", slug: "regulasi", createdAt: daysAgo(41), clicks: 145 },
  { id: "l7", title: "Q&A Forum", original: "https://ppidk-asiania.or.id/layanan/tanya-jawab", slug: "tanya-jawab", createdAt: daysAgo(55), clicks: 98 },
  { id: "l8", title: "Media Kit", original: "https://ppidk-asiania.or.id/media/kit-2026", slug: "media-kit", createdAt: daysAgo(63), clicks: 77 },
  { id: "l9", title: "Newsletter Archive", original: "https://ppidk-asiania.or.id/newsletter/arsip", slug: "arsip-news", createdAt: daysAgo(71), clicks: 64 },
  { id: "l10", title: "Community Database", original: "https://ppidk-asiania.or.id/organisasi/daftar", slug: "org-daftar", createdAt: daysAgo(84), clicks: 51 },
  { id: "l11", title: "Transparency Report", original: "https://ppidk-asiania.or.id/laporan/transparansi", slug: "transparansi", createdAt: daysAgo(96), clicks: 47 },
  { id: "l12", title: "Infographic 2026", original: "https://ppidk-asiania.or.id/materi/infografis", slug: "infografis", createdAt: daysAgo(110), clicks: 33 },
  // Extra rows: total 50 → 5 pages at 10 rows each.
  ...Array.from({ length: 38 }, (_, i) => {
    const n = i + 13;
    return {
      id: `l${n}`,
      title: `Archive Link #${n}`,
      original: `https://ppidk-asiania.or.id/arsip/link-${n}`,
      slug: `arsip-${n}`,
      createdAt: daysAgo(118 + i * 4),
      clicks: 20 + (i % 30),
    };
  }),
];
