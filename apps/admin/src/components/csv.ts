/**
 * Browser download "<name>-YYYY-MM-DD.csv" of rows quoted with `esc` (format.ts), UTF-8 with BOM
 * so Excel reads it.
 */
export function downloadCsv(name: string, rows: readonly (readonly string[])[]) {
  const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
