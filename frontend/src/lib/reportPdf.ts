import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { saveReportFile } from "./reportFiles";

export function buildReportPdf(title: string, headers: string[], rows: (string | number)[][]): Uint8Array {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setFontSize(12);
  pdf.text(title, 14, 14);
  autoTable(pdf, { head: [headers], body: rows, startY: 22, styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [37, 99, 235] }, margin: { left: 10, right: 10 } });
  return new Uint8Array(pdf.output("arraybuffer"));
}

export function exportReportPdf(filename: string, title: string, headers: string[], rows: (string | number)[][]): Promise<string> {
  return saveReportFile(filename.endsWith(".pdf") ? filename : `${filename}.pdf`, buildReportPdf(title, headers, rows), "application/pdf");
}
