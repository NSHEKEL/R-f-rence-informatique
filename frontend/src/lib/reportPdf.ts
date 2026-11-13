import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { saveReportFile } from "./reportFiles";

export function buildReportPdf(title: string, headers: string[], rows: (string | number)[][], footer = ""): Uint8Array {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setFontSize(12);
  const titleLines = pdf.splitTextToSize(title, 265);
  pdf.text(titleLines, 14, 14);
  const footerLines: string[] = footer ? pdf.splitTextToSize(footer, 270) : [];
  autoTable(pdf, { head: [headers], body: rows, startY: 18 + titleLines.length * 5, styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [37, 99, 235] }, margin: { left: 10, right: 10, bottom: 12 + footerLines.length * 2 }, didDrawPage: () => { if (footerLines.length) { pdf.setFontSize(6); pdf.text(footerLines, 12, 205 - footerLines.length * 2); } } });
  return new Uint8Array(pdf.output("arraybuffer"));
}

export function exportReportPdf(filename: string, title: string, headers: string[], rows: (string | number)[][], footer = ""): Promise<string> {
  return saveReportFile(filename.endsWith(".pdf") ? filename : `${filename}.pdf`, buildReportPdf(title, headers, rows, footer), "application/pdf");
}
