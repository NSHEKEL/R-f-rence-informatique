import type { ReceiptFormat } from "../types";

const PAGE_STYLE_ID = "receipt-page-style";
const PRINT_ROOT_ID = "receipt-print-root";
const MM_PER_PX = 25.4 / 96;
const TICKET_WIDTH_MM = 80;
const TICKET_MARGIN_MM = 3;
const TICKET_MIN_HEIGHT_MM = 60;
const TICKET_SLACK_MM = 4;

/** Height of the hidden print copy, measured at its printing width. */
function ticketHeightMm(): number {
  const root = document.getElementById(PRINT_ROOT_ID);
  if (!root) return TICKET_MIN_HEIGHT_MM;
  root.style.cssText =
    "display:block;position:absolute;visibility:hidden;left:-9999px;top:0";
  const height = root.scrollHeight * MM_PER_PX;
  root.style.cssText = "";
  return Math.ceil(
    Math.max(TICKET_MIN_HEIGHT_MM, height + 2 * TICKET_MARGIN_MM) +
      TICKET_SLACK_MM
  );
}

function pageRule(format: ReceiptFormat): string {
  if (format === "80mm") {
    // Thermal roll: `auto` is invalid next to a length, so the exact ticket
    // length is measured to avoid both blank feed and a truncated ticket.
    return `@page { size: ${TICKET_WIDTH_MM}mm ${ticketHeightMm()}mm; margin: ${TICKET_MARGIN_MM}mm; }`;
  }
  return "@page { size: A4 portrait; margin: 12mm; }";
}

const SHEET_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { font-size: 12px; color: #64748b; margin: 0 0 16px; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase;
       letter-spacing: .04em; color: #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
  th { background: #f1f5f9; }
  td.num, th.num { text-align: right; }
  td.blank { width: 22%; height: 22px; }
  @page { size: A4 portrait; margin: 12mm; }
`;

/**
 * Prints a standalone document without opening a second window: the desktop
 * application has no browser to pop up, so the page is rendered in a hidden
 * frame and only that frame reaches the paper.
 */
export function printDocument(
  title: string,
  style: string,
  bodyHtml: string
): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc =
    `<html><head><title>${title}</title><style>${style}</style></head>` +
    `<body>${bodyHtml}</body></html>`;
  frame.onload = () => {
    const view = frame.contentWindow;
    if (view) {
      view.focus();
      view.print();
    }
    // The dialog is modal, so the frame is only dropped afterwards.
    window.setTimeout(() => frame.remove(), 1000);
  };
  document.body.appendChild(frame);
}

/** Prints an A4 sheet (report, inventory count sheet, delivery note). */
export function printSheet(title: string, bodyHtml: string): void {
  printDocument(title, SHEET_STYLE, bodyHtml);
}

const LABEL_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0;
         padding: 6mm; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm; }
  .label { width: 60mm; box-sizing: border-box; border: 1px dashed #94a3b8;
           border-radius: 3mm; padding: 3mm; text-align: center;
           page-break-inside: avoid; }
  .shop { font-size: 9px; text-transform: uppercase; letter-spacing: .08em;
          color: #64748b; margin: 0; }
  .name { font-size: 12px; font-weight: 700; margin: 1mm 0; min-height: 9mm; }
  .price { font-size: 20px; font-weight: 800; margin: 0; }
  .wholesale { font-size: 10px; color: #334155; margin: 1mm 0 0; }
  .code { font-size: 9px; color: #64748b; margin: 1mm 0 0; }
  .qr { width: 18mm; height: 18mm; margin: 1mm auto 0; display: block; }
  @page { size: A4 portrait; margin: 6mm; }
`;

/** Price labels, laid out as a cuttable grid on A4. */
export function printLabels(title: string, labelsHtml: string): void {
  printDocument(title, LABEL_STYLE, `<div class="grid">${labelsHtml}</div>`);
}

/** Applies the page geometry matching the receipt format, then prints. */
export function printReceipt(format: ReceiptFormat): void {
  let style = document.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = pageRule(format);
  window.print();
}
