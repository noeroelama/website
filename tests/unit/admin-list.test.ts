import { describe, expect, it } from "vitest";
import {
  cardRoles,
  columnValues,
  countText,
  emptyText,
  filterRows,
  matchesDate,
  moveItem,
  nextSort,
  PAGE_SIZE_OPTIONS,
  pageSlice,
  runEach,
  sortRows,
  sortSummary,
  toggled,
  withIds,
} from "../../apps/admin/src/components/list-model";

describe("admin list pages: sort, page, select, bulk actions", () => {
  const rows = [
    { id: "a", title: "Beta", n: 2 },
    { id: "b", title: "alpha", n: 10 },
    { id: "c", title: "Gamma", n: 1 },
  ];

  it("sorts by a value, ascending or descending, without changing the input", () => {
    expect(sortRows(rows, (r) => r.title.toLowerCase(), "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("a header click sorts ascending first, the same header again toggles the direction", () => {
    expect(nextSort({ key: null, dir: "asc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "desc" }, "date")).toEqual({ key: "date", dir: "asc" });
  });

  it("shows one page of rows and keeps the page inside the range", () => {
    const many = Array.from({ length: 25 }, (_, i) => i);
    expect(pageSlice(many, 1, 10)).toEqual({ page: 1, rows: many.slice(0, 10) });
    expect(pageSlice(many, 3, 10)).toEqual({ page: 3, rows: [20, 21, 22, 23, 24] });
    expect(pageSlice(many, 9, 10)).toEqual({ page: 3, rows: [20, 21, 22, 23, 24] });
    expect(pageSlice([], 2, 10)).toEqual({ page: 1, rows: [] });
  });

  it("filters dates by today, this month, this year or past (ISO dates, UTC)", () => {
    const today = "2026-10-24";
    expect(matchesDate("2026-10-24T09:00:00.000Z", "today", today)).toBe(true);
    expect(matchesDate("2026-10-23T09:00:00.000Z", "today", today)).toBe(false);
    expect(matchesDate("2026-10-01T00:00:00.000Z", "month", today)).toBe(true);
    expect(matchesDate("2026-09-30T00:00:00.000Z", "month", today)).toBe(false);
    expect(matchesDate("2026-01-01T00:00:00.000Z", "year", today)).toBe(true);
    expect(matchesDate("2025-12-31T00:00:00.000Z", "year", today)).toBe(false);
    expect(matchesDate("2026-10-23T00:00:00.000Z", "past", today)).toBe(true);
    expect(matchesDate("2026-10-24T00:00:00.000Z", "past", today)).toBe(false);
    expect(matchesDate("2020-01-01T00:00:00.000Z", "all", today)).toBe(true);
  });

  it("selects and unselects rows without changing the current selection object", () => {
    const current = new Set(["a"]);
    expect([...toggled(current, "b")]).toEqual(["a", "b"]);
    expect([...toggled(current, "a")]).toEqual([]);
    expect([...withIds(current, ["b", "c"], true)]).toEqual(["a", "b", "c"]);
    expect([...withIds(new Set(["a", "b", "c"]), ["a", "b"], false)]).toEqual(["c"]);
    expect([...current]).toEqual(["a"]);
  });

  it("names a count with the right plural", () => {
    expect(countText(1, "event")).toBe("1 event");
    expect(countText(3, "album")).toBe("3 albums");
    expect(countText(0, "article")).toBe("0 articles");
  });

  it("runs one action per row in order and stops at the first refusal", async () => {
    const seen: string[] = [];
    const ok = await runEach(rows, (r) => {
      seen.push(r.id);
      return Promise.resolve({ ok: true as const });
    });
    expect(ok).toEqual({ count: 3, failure: null });
    expect(seen).toEqual(["a", "b", "c"]);

    const refused = { ok: false as const, error: "conflict" };
    seen.length = 0;
    const stopped = await runEach(rows, (r) => {
      seen.push(r.id);
      return Promise.resolve(r.id === "b" ? refused : { ok: true as const });
    });
    expect(stopped).toEqual({ count: 1, failure: refused });
    expect(seen).toEqual(["a", "b"]);
  });

  it("says why a list is empty: a search, filters, or no records yet", () => {
    const base = { noun: "event", query: "", filters: 0, emptyHint: "Add the first event." };
    expect(emptyText(base)).toEqual({ title: "No events yet", hint: "Add the first event." });
    expect(emptyText({ ...base, query: " expo " })).toEqual({
      title: "No events match “expo”",
      hint: "Try a new search or clear it.",
    });
    expect(emptyText({ ...base, filters: 1 })).toEqual({
      title: "No events match your filters",
      hint: "1 filter is on. Try a new search or clear them.",
    });
    expect(emptyText({ ...base, query: "x", filters: 2 })).toEqual({
      title: "No events match “x”",
      hint: "2 filters are on. Try a new search or clear them.",
    });
  });

  it("moves one item for drag & drop, ignoring moves out of range", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 5)).toEqual(["a", "b", "c"]);
  });
});

describe("admin list pages: phone card layout", () => {
  it("leading controls, row actions and the first other column pick their card place", () => {
    expect(cardRoles(["check", "title", "date", "status", "aksi"])).toEqual([
      "lead",
      "title",
      "meta",
      "meta",
      "actions",
    ]);
    expect(cardRoles(["name", "role", "edit"])).toEqual(["title", "meta", "actions"]);
    expect(cardRoles(["expand", "date", "user", "revert"])).toEqual([
      "lead",
      "title",
      "meta",
      "actions",
    ]);
  });

  it("the summary line says how the list is ordered: dates by age, the rest A–Z", () => {
    expect(sortSummary("Event Date", "desc")).toBe("Newest first");
    expect(sortSummary("Last Modified", "asc")).toBe("Oldest first");
    expect(sortSummary("Event", "asc")).toBe("A–Z");
    expect(sortSummary("Status", "desc")).toBe("Z–A");
  });

  it("offers 10, 25 or 50 rows per page", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 25, 50]);
  });

  it("a column's filter checklist lists its values once, in the column's sort order", () => {
    const dated = [
      { id: "a", day: "2 Nov 2026", at: 2 },
      { id: "b", day: "10 Nov 2026", at: 10 },
      { id: "c", day: "2 Nov 2026", at: 2 },
    ];
    expect(
      columnValues(
        dated,
        (r) => r.day,
        (r) => r.at,
      ),
    ).toEqual(["2 Nov 2026", "10 Nov 2026"]);
  });

  it("column filters hide the rows whose value was unticked, in every filtered column", () => {
    const rows = [
      { id: "a", title: "Beta", n: 2 },
      { id: "b", title: "alpha", n: 10 },
      { id: "c", title: "Gamma", n: 1 },
    ];
    const text = (r: (typeof rows)[number], key: "title" | "n") =>
      key === "title" ? r.title : String(r.n);
    expect(filterRows(rows, {}, text)).toEqual(rows);
    expect(filterRows(rows, { title: new Set(["Beta"]) }, text).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
    expect(
      filterRows(rows, { title: new Set(["Beta"]), n: new Set(["1"]) }, text).map((r) => r.id),
    ).toEqual(["b"]);
    expect(filterRows(rows, { title: new Set<string>() }, text)).toEqual(rows);
  });
});
