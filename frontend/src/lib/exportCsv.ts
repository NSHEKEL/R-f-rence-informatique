/**
 * Save a table as a CSV file Excel opens directly.
 *
 * Excel in French reads a semicolon as the column separator and needs the
 * byte-order mark to show accented letters correctly.
 */
function cell(value: string | number): string {
  const text = String(value ?? "");
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const body = [headers, ...rows]
    .map((row) => row.map(cell).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** File name stamped with the day, so exports never overwrite each other. */
export function stampedName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}
