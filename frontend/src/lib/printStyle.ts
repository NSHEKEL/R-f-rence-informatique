import { DEFAULT_PRINTING, type DocumentConfig, type PrinterDevice, type PrintingConfig, type ReceiptPrinterConfig } from "../types";

export const PRINT_FONTS = ["Arial", "Helvetica", "Verdana", "Tahoma", "Georgia", "Courier New", "Times New Roman"];
export const escapePrint = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export const printFont = (value: string) => PRINT_FONTS.includes(value) ? value : "Arial";
export const printColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
export const printNumber = (value: number, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function mergePrinting(raw?: Partial<PrintingConfig> | null): PrintingConfig {
  return { receipt: { ...DEFAULT_PRINTING.receipt, ...raw?.receipt }, label: { ...DEFAULT_PRINTING.label, ...raw?.label }, documents: { ...DEFAULT_PRINTING.documents, ...raw?.documents } };
}
export function ticketCapabilities(config: ReceiptPrinterConfig, devices: PrinterDevice[]) {
  const raw = config.width === "58mm" || config.width === "80mm";
  const device = config.printer_name ? devices.find((item) => item.name === config.printer_name) : devices.find((item) => item.is_default);
  return { raw, color: !raw && device?.supports_color === true, font: !raw };
}
export function rememberPrinterCapabilities(devices: PrinterDevice[]) {
  try { localStorage.setItem("ri_printer_capabilities", JSON.stringify({ ...Object.fromEntries(devices.map((device) => [device.name, device.supports_color === true])), "": devices.find((device) => device.is_default)?.supports_color === true })); } catch { /* storage unavailable */ }
}
export function printerColorAllowed(name: string): boolean {
  try { return JSON.parse(localStorage.getItem("ri_printer_capabilities") || "{}")[name] === true; } catch { return false; }
}
export function receiptPreset(width: "58mm" | "80mm"): ReceiptPrinterConfig {
  return { ...DEFAULT_PRINTING.receipt, width, paper_width_mm: width === "58mm" ? 58 : 80, font_size: width === "58mm" ? 10 : 11, logo_size_mm: width === "58mm" ? 14 : 18 };
}
export function commercialStyle(config: DocumentConfig): string {
  const c = { ...DEFAULT_PRINTING.documents, ...config };
  return `.commercial-document { font-family:"${printFont(c.font_family)}";font-size:${printNumber(c.font_size,12,8,24)}px;color:${printColor(c.text_color)}; }
    .commercial-document * {font-family:inherit;color:inherit}
    .commercial-document .company,.commercial-document .party,.commercial-document .dates,.commercial-document .sign,.commercial-document .terms,.commercial-document .mention {font-size:inherit}
    .commercial-document table,.commercial-document td,.commercial-document th {font-family:inherit;font-size:inherit;color:inherit}
    .commercial-document h1,.commercial-document h2,.commercial-document .number {color:${printColor(c.accent_color)}}
    .commercial-document .doc-head,.commercial-document .head,.commercial-document .receipt-head {text-align:${c.info_position}!important;flex-direction:${c.info_position === 'right' ? 'row-reverse' : 'row'}!important;justify-content:${c.info_position === 'center' ? 'center' : 'space-between'}!important}
    .commercial-document .doc-head img,.commercial-document .head img.logo,.commercial-document .receipt-logo {height:${printNumber(c.logo_size_mm,22,5,60)}mm!important;width:${printNumber(c.logo_size_mm,22,5,60)}mm!important;max-width:60mm;object-fit:contain;${c.show_logo ? '' : 'display:none!important;'}}
    ${c.show_company ? '' : '.commercial-document .company,.commercial-document .doc-head>div,.commercial-document .receipt-company,.commercial-document .receipt-slogan,.commercial-document .receipt-contact {display:none!important}'}
    ${c.show_customer ? '' : '.commercial-document .customer-info,.commercial-document .party:first-child {display:none!important}'}
    ${c.show_reference ? '' : '.commercial-document .number,.commercial-document .document-reference {display:none!important}'}
    ${c.show_date ? '' : '.commercial-document .dates,.commercial-document .document-date {display:none!important}'}
    ${c.show_qty ? '' : '.commercial-document [data-field="qty"] {display:none!important}'}
    ${c.show_unit_price ? '' : '.commercial-document [data-field="price"] {display:none!important}'}
    ${c.show_total ? '' : '.commercial-document [data-field="total"],.commercial-document .totals,.commercial-document .receipt-total {display:none!important}'}
    .commercial-document .shared-footer {margin-top:8mm;text-align:center;white-space:pre-wrap}.commercial-document .shared-header {white-space:pre-wrap;margin-bottom:5mm}`;
}
export function commercialMarkup(html: string, config: DocumentConfig): string {
  return `<style>${commercialStyle(config)}</style><div class="commercial-document"><div class="shared-header">${escapePrint(config.header_text || '')}</div>${html}<div class="shared-footer">${escapePrint(config.footer_text || '')}</div></div>`;
}
