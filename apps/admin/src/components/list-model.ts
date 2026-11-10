export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export type SortDir = "asc" | "desc";

export interface SortState<K> {
  key: K | null;
  dir: SortDir;
}

export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | number,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "asc" ? cmp : -cmp;
  });
}

export type ColumnFilters<K extends string> = Partial<Record<K, ReadonlySet<string>>>;

export function columnValues<T>(
  rows: readonly T[],
  text: (row: T) => string,
  value: (row: T) => string | number,
): string[] {
  return [...new Set(sortRows(rows, value, "asc").map(text))];
}

export function filterRows<T, K extends string>(
  rows: readonly T[],
  filters: ColumnFilters<K>,
  text: (row: T, key: K) => string,
): readonly T[] {
  const active = (Object.entries(filters) as [K, ReadonlySet<string>][]).filter(
    ([, hidden]) => hidden.size > 0,
  );
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(([key, hidden]) => !hidden.has(text(row, key))));
}

export function nextSort<K>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: "asc" };
}

export function pageSlice<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { page: number; rows: T[] } {
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, last);
  return { page: safe, rows: rows.slice((safe - 1) * pageSize, safe * pageSize) };
}

export type DateFilter = "all" | "today" | "month" | "year" | "past";

export function matchesDate(iso: string, filter: DateFilter, today: string): boolean {
  const day = iso.slice(0, 10);
  switch (filter) {
    case "all":
      return true;
    case "today":
      return day === today;
    case "month":
      return day.startsWith(today.slice(0, 7));
    case "year":
      return day.startsWith(today.slice(0, 4));
    case "past":
      return day < today;
  }
}

export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function withIds(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** The ticked rows that are still shown; bulk actions never act on a row hidden by a filter. */
export function shownSelection(
  shown: readonly { id: string }[],
  picked: ReadonlySet<string>,
): Set<string> {
  return new Set(shown.filter((row) => picked.has(row.id)).map((row) => row.id));
}

export const countText = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function runEach<T, F extends { ok: false }>(
  rows: readonly T[],
  run: (row: T) => Promise<{ ok: true } | F>,
): Promise<{ count: number; failure: F | null }> {
  let count = 0;
  for (const row of rows) {
    const result = await run(row);
    if (!result.ok) return { count, failure: result };
    count++;
  }
  return { count, failure: null };
}

export function emptyText(state: {
  noun: string;
  query: string;
  filters: number;
  emptyHint: string;
}): { title: string; hint: string } {
  const query = state.query.trim();
  const title = query
    ? `No ${state.noun}s match “${query}”`
    : state.filters > 0
      ? `No ${state.noun}s match your filters`
      : `No ${state.noun}s yet`;
  const hint =
    state.filters > 0
      ? `${state.filters} filter${state.filters === 1 ? " is" : "s are"} on. Try a new search or clear them.`
      : query
        ? "Try a new search or clear it."
        : state.emptyHint;
  return { title, hint };
}

export type CardRole = "lead" | "title" | "meta" | "actions";

const LEAD_KEYS = new Set(["check", "expand"]);
const ACTION_KEYS = new Set(["aksi", "actions", "edit", "open", "revert"]);

export function cardRoles(keys: readonly string[]): CardRole[] {
  let titled = false;
  return keys.map((key) => {
    if (LEAD_KEYS.has(key)) return "lead";
    if (ACTION_KEYS.has(key)) return "actions";
    if (titled) return "meta";
    titled = true;
    return "title";
  });
}

const DATE_LABEL = /date|modified|created|sent|submitted|opens|subscribed/i;

export function sortSummary(label: string, dir: SortDir): string {
  if (DATE_LABEL.test(label)) return dir === "desc" ? "Newest first" : "Oldest first";
  return dir === "asc" ? "A–Z" : "Z–A";
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1) as [T];
  next.splice(to, 0, moved);
  return next;
}
