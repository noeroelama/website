/** Pure helpers for the Dashboard page-views chart (components/page-views-card.tsx). */

/** Axis steps 0 … just above `max`, in round steps (1, 2 or 5 × 10ⁿ), at most 6 steps. */
export function axisTicks(max: number): number[] {
  const top = Math.max(1, max);
  let step = Math.max(1, 10 ** Math.floor(Math.log10(top / 6))); // whole views only
  for (const factor of [1, 2, 5, 10]) {
    if (top / (step * factor) <= 6) {
      step *= factor;
      break;
    }
  }
  const count = Math.ceil(top / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-11" → "Oct 11", "2026-11" → "Nov 2026", "2026" → "2026" (periods are UTC). */
export function pointLabel(period: string): string {
  const [year, month, day] = period.split("-");
  const name = month ? MONTHS[Number(month) - 1] : undefined;
  if (!name) return period;
  return day ? `${name} ${day}` : `${name} ${year}`;
}

/** Page dropdown: all pages ("*"), the chosen page, then each page viewed in the period. */
export function pageOptions(
  pages: ReadonlyArray<{ page: string }>,
  current: string,
): { value: string; label: string }[] {
  const listed = pages.map((p) => p.page);
  const values = [
    "*",
    ...(current === "*" || listed.includes(current) ? [] : [current]),
    ...listed,
  ];
  return values.map((value) => ({ value, label: value === "*" ? "All pages" : value }));
}
