/** Dates on admin pages are shown in UTC (the viewer's zone is not known on the server). */
export function formatUtc(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}
