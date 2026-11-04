/**
 * Pure rules shared by the dark list pages (Event, Gallery, Article, Newsletter, Audit Log):
 * sorting, paging, the date filter, row selection and bulk actions. The React side is
 * `ui/list-controls.tsx`.
 */

/** Rows-per-page choices of the list pages. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export type SortDir = "asc" | "desc";

export interface SortState<K> {
  key: K | null;
  dir: SortDir;
}

/** A copy of `rows` ordered by `value`. */
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

/** Header click: a new column sorts ascending, the same column toggles the direction. */
export function nextSort<K>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: "asc" };
}

/** One page of rows; a page past the end (after filtering) becomes the last page. */
export function pageSlice<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { page: number; rows: T[] } {
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, last);
  return { page: safe, rows: rows.slice((safe - 1) * pageSize, safe * pageSize) };
}

/** Date filter of the list pages (compares ISO dates, UTC). */
export type DateFilter = "all" | "today" | "month" | "year" | "past";

/** Does an ISO timestamp fall in the filter? `today` is `YYYY-MM-DD`. */
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

/** The selection with `id` switched on or off. */
export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The selection with all `ids` added (`on`) or removed. */
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

/** "1 event", "3 events". */
export const countText = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * One server action per row, one after the other (each has its own version check); stops at
 * the first refusal and returns how many succeeded.
 */
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

/** Why the list is empty: the search, the filters that are on, or no records yet. */
export function emptyText(state: {
  noun: string;
  query: string;
  filters: number;
  /** Shown when nothing is filtered ("Add the first event."). */
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

/** Where a column goes in the phone card (`DataTable` cards, `globals.css` "Mobile list cards"). */
export type CardRole = "lead" | "title" | "meta" | "actions";

const LEAD_KEYS = new Set(["check", "expand"]);
const ACTION_KEYS = new Set(["aksi", "actions", "edit", "open", "revert"]);

/**
 * Card place of each column, by its key: the checkbox / expander leads, the row buttons are the
 * action row, the first other column is the title and the rest are detail lines.
 */
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

/** Header labels of date columns: their order reads "Newest first". */
const DATE_LABEL = /date|modified|created|sent|submitted|opens|subscribed/i;

/** How the list is ordered, for the phone summary line ("112 events · Newest first"). */
export function sortSummary(label: string, dir: SortDir): string {
  if (DATE_LABEL.test(label)) return dir === "desc" ? "Newest first" : "Oldest first";
  return dir === "asc" ? "A–Z" : "Z–A";
}

/** A copy of `items` with the item at `from` moved to `to` (drag & drop); out of range = same. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1) as [T];
  next.splice(to, 0, moved);
  return next;
}
