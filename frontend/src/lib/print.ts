import type { ReceiptFormat } from "../types";

const PAGE_STYLE_ID = "receipt-page-style";

const PAGE_RULES: Record<ReceiptFormat, string> = {
  // Standard printer: centered ticket on a portrait sheet.
  A4: "@page { size: A4 portrait; margin: 12mm; }",
  // Thermal roll: full width, continuous height so nothing is cut off.
  "80mm": "@page { size: 80mm auto; margin: 3mm; }",
};

/** Applies the page geometry matching the receipt format, then prints. */
export function printReceipt(format: ReceiptFormat): void {
  let style = document.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = PAGE_RULES[format];
  window.print();
}
