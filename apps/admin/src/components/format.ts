/** Dates on admin pages are shown in UTC (the viewer's zone is not known on the server). */
export function formatUtc(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

/** URL shown without its scheme or trailing slash, e.g. "https://goppi.id/" → "goppi.id". */
export function withoutScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Humanised "x time ago" (e.g. "2 hours ago", "3 days ago") from an ISO timestamp. */
export function timeAgo(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = Math.max(0, now - d.getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * ISO instant shown on the clock of `timeZone`, e.g. "20 Nov 2026, 11:00", or "20 Nov 2026" with
 * `withTime = false` (same on server and browser).
 */
export function formatInZone(iso: string, timeZone: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(iso));
}

/**
 * One CSV cell, quoted (inner quotes doubled); rows go to `downloadCsv` (csv.ts). A cell that a
 * spreadsheet would run as a formula (starts with = + - @, tab or carriage return) gets a
 * leading apostrophe, so typed-in answers can never execute ("CSV injection").
 */
export const esc = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
