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

/** Native window bridge: it saves the file itself, downloads being blocked. */
function desktopSave(): ((name: string, body: string) => Promise<string>) | undefined {
  return (
    window as unknown as {
      pywebview?: {
        api?: { save_file?: (name: string, body: string) => Promise<string> };
      };
    }
  ).pywebview?.api?.save_file;
}

/**
 * Returns where the file went: the path the desktop bridge wrote, the file
 * name for a browser download, or "" when the user cancelled the save dialog.
 * Throws when the save itself fails so callers can show the reason.
 */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<string> {
  const body = [headers, ...rows]
    .map((row) => row.map(cell).join(";"))
    .join("\r\n");
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const save = desktopSave();
  if (save) {
    return (await save(name, body)) || "";
  }
  const blob = new Blob(["\uFEFF" + body], {
    type: "text/csv;charset=utf-8;",
  });
  // Chrome/Edge: ask where to save, like the desktop save dialog does.
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: object) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [
          {
            description: "Fichier Excel (CSV)",
            accept: { "text/csv": [".csv"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return name;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "";
      }
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}

/** File name stamped with the day, so exports never overwrite each other. */
export function stampedName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}
