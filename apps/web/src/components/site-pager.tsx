function pageNumbers(current: number, total: number): ReadonlyArray<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | "…"> = [1];

  const head = Math.max(2, current - 1);
  const tail = Math.min(total - 2, current + 1);
  if (head > 2) pages.push("…");
  for (let n = head; n <= tail; n += 1) pages.push(n);
  if (tail < total - 2) pages.push("…");
  pages.push(total - 1, total);
  return pages;
}

export function SitePager({
  page,
  pages,
  hrefOf,
  label,
}: {
  page: number;
  pages: number;
  hrefOf: (page: number) => string;
  label: string;
}) {
  return (
    <nav className="site-lists__pager" aria-label={label}>
      {pageNumbers(page, pages).map((n, i) =>
        n === "…" ? (
          <span className="site-lists__pager-dots" key={`dots-${i}`}>
            …
          </span>
        ) : (
          <a
            className="site-lists__pager-num"
            href={hrefOf(n)}
            aria-current={n === page ? "page" : undefined}
            key={n}
          >
            {n}
          </a>
        ),
      )}
    </nav>
  );
}
