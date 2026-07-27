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
