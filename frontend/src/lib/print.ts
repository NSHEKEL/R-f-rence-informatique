import type { CompanySettings, ReceiptFormat } from "../types";

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
    // Zero page margin keeps the printer from adding the URL, the date and the
    // page number around the ticket; the padding is applied to the copy itself.
    return (
      `@page { size: ${TICKET_WIDTH_MM}mm ${ticketHeightMm()}mm; margin: 0; }` +
      `#${PRINT_ROOT_ID} { padding: ${TICKET_MARGIN_MM}mm; }`
    );
  }
  return (
    "@page { size: A4 portrait; margin: 0; }" +
    `#${PRINT_ROOT_ID} { padding: 12mm; }`
  );
}

const SHEET_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a;
         margin: 0; padding: 12mm; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .doc-head { display: flex; align-items: center; gap: 12px;
              border-bottom: 2px solid #0f172a; padding-bottom: 8px;
              margin-bottom: 12px; }
  .doc-head img { width: 68px; height: 68px; object-fit: contain; }
  .doc-head .meta { margin: 0; }
  p.meta { font-size: 12px; color: #64748b; margin: 0 0 16px; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase;
       letter-spacing: .04em; color: #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
  th { background: #f1f5f9; }
  td.num, th.num { text-align: right; }
  td.blank { width: 22%; height: 22px; }
  /* No page margin: the printer would otherwise stamp the address, the date
     and the page number in the header and the footer of the sheet. */
  @page { size: A4 portrait; margin: 0; }
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

/**
 * Letterhead of every printed document: the company logo next to its name
 * and contact details, so orders, delivery notes, proformas and inventory
 * sheets look like the shop's own stationery.
 */
export function documentHeader(company: CompanySettings | null): string {
  const contact = [company?.address, company?.phone, company?.email]
    .filter(Boolean)
    .join(" · ");
  return (
    `<div class="doc-head">` +
    (company?.logo ? `<img src="${company.logo}" alt="" />` : "") +
    `<div><h1>${company?.name ?? ""}</h1>` +
    (contact ? `<p class="meta">${contact}</p>` : "") +
    `</div></div>`
  );
}

/** Prints an A4 sheet (report, inventory count sheet, delivery note). */
export function printSheet(title: string, bodyHtml: string): void {
  printDocument(title, SHEET_STYLE, bodyHtml);
}

const LABEL_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0;
         padding: 6mm; }
  @page { size: A4 portrait; margin: 0; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm; }
  .label { width: 60mm; box-sizing: border-box; border: 1px dashed #94a3b8;
           border-radius: 3mm; padding: 3mm; text-align: center;
           page-break-inside: avoid; }
  .shop-logo { height: 8mm; max-width: 30mm; object-fit: contain;
               display: block; margin: 0 auto 1mm; }
  .shop { font-size: 9px; text-transform: uppercase; letter-spacing: .08em;
          color: #64748b; margin: 0; }
  .name { font-size: 12px; font-weight: 700; margin: 1mm 0; min-height: 9mm; }
  .price { font-size: 20px; font-weight: 800; margin: 0; }
  .wholesale { font-size: 10px; color: #334155; margin: 1mm 0 0; }
  .code { font-size: 9px; color: #64748b; margin: 1mm 0 0; }
  .qr { width: 18mm; height: 18mm; margin: 1mm auto 0; display: block; }
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
