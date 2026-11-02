/**
 * Save a table as a real Excel file (.xls, SpreadsheetML 2003).
 *
 * The header row is formatted (bold white text on the brand blue) and numbers
 * stay typed as numbers, so the file opens clean in Excel — unlike a CSV,
 * which cannot carry any formatting.
 */
function esc(value: string | number): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellXml(value: string | number, header: boolean): string {
  const style = header ? ' ss:StyleID="h"' : "";
  const type = typeof value === "number" ? "Number" : "String";
  return `<Cell${style}><Data ss:Type="${type}">${esc(value)}</Data></Cell>`;
}

function workbookXml(headers: string[], rows: (string | number)[][]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    "<Styles>" +
    '<Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/>' +
    '<Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style>' +
    "</Styles>\n" +
    '<Worksheet ss:Name="Export"><Table>\n' +
    `<Row>${headers.map((h) => cellXml(h, true)).join("")}</Row>\n` +
    rows
      .map((row) => `<Row>${row.map((c) => cellXml(c, false)).join("")}</Row>`)
      .join("\n") +
    "\n</Table></Worksheet></Workbook>"
  );
}

/** Native window bridge: it saves the file itself, downloads being blocked. */
function desktopSave():
  | ((name: string, body: string) => Promise<string>)
  | undefined {
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
  const body = workbookXml(headers, rows);
  const name = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  const save = desktopSave();
  if (save) {
    return (await save(name, body)) || "";
  }
  const blob = new Blob([body], { type: "application/vnd.ms-excel" });
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
            description: "Classeur Excel",
            accept: { "application/vnd.ms-excel": [".xls"] },
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
