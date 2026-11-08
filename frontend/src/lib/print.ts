import type {
  CompanySettings,
  LabelPrinterConfig,
  ReceiptFormat,
  ReceiptPrinterConfig,
  DocumentConfig,
} from "../types";
import { DEFAULT_PRINTING } from "../types";
import { barcodeDataUrl } from "./barcode";
import { cacheRead } from "./offline";
import { ticketLines } from "./ticketText";
import { commercialMarkup, printFont, printNumber } from "./printStyle";

const PAGE_STYLE_ID = "receipt-page-style";
const PRINT_ROOT_ID = "receipt-print-root";
const MM_PER_PX = 25.4 / 96;
const TICKET_WIDTH_MM = 80;
const NARROW_WIDTH_MM = 58;
const TICKET_MARGIN_MM = 3;
const TICKET_MIN_HEIGHT_MM = 60;
const TICKET_SLACK_MM = 4;

/** Paper width of a receipt format, in millimetres. */
function widthMm(format: ReceiptFormat, custom = 80): number {
  if (format === "custom") return printNumber(custom, 80, 40, 216);
  return format === "58mm" ? NARROW_WIDTH_MM : TICKET_WIDTH_MM;
}

/** Height of the hidden print copy, measured at its printing width. */
function ticketHeightMm(): number {
  const root = document.getElementById(PRINT_ROOT_ID);
  if (!root) return TICKET_MIN_HEIGHT_MM;
  const previous = root.style.cssText;
  root.style.cssText =
    previous + ";display:block;position:absolute;visibility:hidden;left:-9999px;top:0";
  const height = root.scrollHeight * MM_PER_PX;
  root.style.cssText = previous;
  return Math.ceil(
    Math.max(TICKET_MIN_HEIGHT_MM, height + 2 * TICKET_MARGIN_MM) +
      TICKET_SLACK_MM
  );
}

/**
 * Native printer of the desktop window. The web dialog always stamps the
 * date, the window title, the local address and a page number around the
 * ticket; the native bridge prints the same styled page without them.
 */
function desktopPrint():
  | ((width: number, height: number, margin: number) => Promise<boolean>)
  | undefined {
  return (
    window as unknown as {
      pywebview?: {
        api?: {
          print_page?: (
            width: number,
            height: number,
            margin: number
          ) => Promise<boolean>;
        };
      };
    }
  ).pywebview?.api?.print_page;
}

/**
 * Counter printer of the desktop window: it prints the ticket itself, so no
 * print preview and no browser header ever reach the paper.
 */
function desktopTicket():
  | ((payload: string) => Promise<string>)
  | undefined {
  return (
    window as unknown as {
      pywebview?: { api?: { print_ticket?: (payload: string) => Promise<string> } };
    }
  ).pywebview?.api?.print_ticket;
}

/**
 * Silent print to a chosen printer through WebView2 PrintSettings.
 * Only available inside the packaged application.
 */
function desktopPrintTo():
  | ((
      width: number,
      height: number,
      margin: number,
      printer: string
    ) => Promise<boolean>)
  | undefined {
  return (
    window as unknown as {
      pywebview?: {
        api?: {
          print_to?: (
            width: number,
            height: number,
            margin: number,
            printer: string
          ) => Promise<boolean>;
        };
      };
    }
  ).pywebview?.api?.print_to;
}

// The system print preview stamps the page title and its address around the
// paper: the title is emptied for the duration of the job so the document
// alone reaches the printer. Only the desktop bridge prints without any
// surrounding text at all.
let savedTitle: string | null = null;
window.addEventListener("beforeprint", () => {
  savedTitle = document.title;
  document.title = "";
});
window.addEventListener("afterprint", () => {
  if (savedTitle !== null) document.title = savedTitle;
  savedTitle = null;
});

function pageRule(format: ReceiptFormat, marginMm: number, custom = 80): string {
  if (format !== "A4") {
    // Thermal roll: `auto` is invalid next to a length, so the exact ticket
    // length is measured to avoid both blank feed and a truncated ticket.
    // Zero page margin keeps the printer from adding the URL, the date and the
    // page number around the ticket; the padding is applied to the copy itself.
    return (
      `@page { size: ${widthMm(format, custom)}mm ${ticketHeightMm()}mm; margin: 0; }` +
      `#${PRINT_ROOT_ID} { padding: ${marginMm}mm;` +
      ` width: ${widthMm(format, custom)}mm; box-sizing: border-box; }`
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
  .doc-barcode { display: block; margin: 16px auto 0; height: 18mm; }
  /* No page margin: the printer would otherwise stamp the address, the date
     and the page number in the header and the footer of the sheet. */
  @page { size: A4 portrait; margin: 0; }
`;

export interface PrintOptions {
  documentConfig?: DocumentConfig;
  /** Queue the document goes to; empty keeps the Windows default. */
  printerName?: string;
  /** False shows the preview dialog even when a printer is assigned. */
  direct?: boolean;
  requireSilent?: boolean;
  widthMm?: number;
  heightMm?: number;
}

/**
 * Prints a standalone document without opening a second window: the desktop
 * application has no browser to pop up, so the page is rendered in a hidden
 * frame and only that frame reaches the paper. When a printer is assigned
 * and the desktop bridge is available, the sheet leaves straight for that
 * queue — no preview, no Windows dialog.
 */
export function printDocument(
  _title: string,
  style: string,
  bodyHtml: string,
  options?: PrintOptions
): Promise<boolean> {
  const preview = () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc =
      `<html><head><title></title><style>${style}</style></head>` +
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
  };

  const bridge = desktopPrintTo();

  // Preview mode inside the desktop window: the native dialog would stamp the
  // page address and title on the paper, so the sheet is shown in an in-app
  // lightbox and the job itself still goes through the silent bridge.
  const appPreview = (printer?: string) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-easygest-print-preview", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;" +
      "background:rgba(15,23,42,.55);display:flex;flex-direction:column;" +
      "align-items:center;gap:10px;padding:24px;";
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:10px;";
    const base =
      "border:0;border-radius:8px;padding:8px 20px;font:600 14px " +
      "Arial,Helvetica,sans-serif;cursor:pointer;";
    const send = document.createElement("button");
    send.textContent = "Imprimer";
    send.style.cssText = base + "background:#1e3a8a;color:#fff;";
    const close = document.createElement("button");
    close.textContent = "Fermer";
    close.style.cssText = base + "background:#fff;color:#0f172a;";
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "width:min(210mm,92vw);flex:1;background:#fff;border:0;" +
      "border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.4);";
    frame.srcdoc =
      `<html><head><title></title><style>${style}</style></head>` +
      `<body>${bodyHtml}</body></html>`;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(); } };
    const finish = () => { window.removeEventListener?.("keydown", escape, true); frame.contentWindow?.removeEventListener?.("keydown", escape, true); overlay.remove(); };
    window.addEventListener?.("keydown", escape, true);
    frame.onload = () => frame.contentWindow?.addEventListener?.("keydown", escape, true);
    send.onclick = () => {
      if (send.disabled) return;
      send.disabled = true;
      const root = document.createElement("div");
      root.id = PRINT_ROOT_ID;
      root.innerHTML = `<style>${style}</style>${bodyHtml}`;
      document.body.appendChild(root);
      (bridge as NonNullable<typeof bridge>)(
        210,
        297,
        0,
        printer?.trim() ?? ""
      ).catch(() => false).finally(() => {
        root.remove();
        finish();
      });
    };
    close.onclick = finish;
    bar.append(send, close);
    overlay.append(bar, frame);
    document.body.appendChild(overlay);
  };

  if (options?.direct === false || !bridge) {
    if (options?.requireSilent) return Promise.resolve(false);
    if (bridge) appPreview(options?.printerName);
    else preview();
    return Promise.resolve(false);
  }
  // The print stylesheet shows only body > #receipt-print-root: the sheet is
  // mounted there for the duration of the job, like a ticket.
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.innerHTML = `<style>${style}</style>${bodyHtml}`;
  document.body.appendChild(root);
  return bridge(options?.widthMm ?? 210, options?.heightMm ?? 297, 0, options?.printerName?.trim() ?? "")
    .then((done) => {
      if (!done && !options?.requireSilent) preview();
      return done;
    })
    .catch(() => {
      if (!options?.requireSilent) preview();
      return false;
    })
    .finally(() => root.remove());
}

/**
 * Letterhead of every printed document: the company logo next to its name
 * and contact details, so orders, delivery notes, proformas and inventory
 * sheets look like the shop's own stationery.
 */
/** Per-document-type layout overrides stored in company.document_layouts. */
export interface DocumentLayout {
  logo_position?: "gauche" | "centre" | "droite";
  show_contact?: boolean;
  show_admin?: boolean;
}

export function readDocumentLayout(
  company: CompanySettings | null | undefined,
  docType: string
): DocumentLayout {
  try {
    const all = JSON.parse(company?.document_layouts || "{}") as Record<
      string,
      DocumentLayout
    >;
    return all?.[docType] ?? {};
  } catch {
    return {};
  }
}

export function documentHeader(
  settings: CompanySettings | null,
  /** Supplier logo printed instead of the company one on its own documents. */
  logoOverride?: string,
  /** Document kind ("facture", "devis"...) for per-type layout overrides. */
  docType?: string,
  config?: DocumentConfig
): string {
  // Printing right after start-up: the settings may still be loading, so fall
  // back on the copy kept for offline use instead of an empty letterhead.
  const company = settings ?? cacheRead<CompanySettings>("company");
  const layout = docType ? readDocumentLayout(company, docType) : {};
  const place = [company?.city, company?.country].filter(Boolean).join(", ");
  const phones = [company?.phone, company?.phone2].filter(Boolean).join(" / ");
  const contact = [
    config?.show_address === false ? '' : [company?.address, place].filter(Boolean).join(" - "),
    config?.show_phone === false ? '' : phones,
    config?.show_email === false ? '' : company?.email,
    config?.show_website === false ? '' : company?.website,
  ]
    .filter(Boolean)
    .join(" · ");
  const admin = [
    company?.rccm ? `RCCM ${company.rccm}` : "",
    company?.ncc ? `NCC ${company.ncc}` : company?.tax_id ? `NCC ${company.tax_id}` : "",
    company?.capital_social ? `Capital ${company.capital_social}` : "",
    company?.regime_fiscal || "",
  ]
    .filter(Boolean)
    .join(" · ");
  const logo = logoOverride || company?.logo;
  const position = layout.logo_position ?? "gauche";
  const align =
    position === "centre" ? "center" : position === "droite" ? "right" : "left";
  const logoImg = logo ? `<img src="${logo}" alt="" />` : "";
  const text =
    `<div><h1>${company?.name ?? ""}</h1>` +
    (company?.slogan ? `<p class="meta">${company.slogan}</p>` : "") +
    (layout.show_contact === false || !contact
      ? ""
      : `<p class="meta">${contact}</p>`) +
    (layout.show_admin === false || !admin
      ? ""
      : `<p class="meta">${admin}</p>`) +
    `</div>`;
  if (position === "centre") {
    return `<div class="doc-head" style="justify-content:center;text-align:center">${logoImg}${text}</div>`;
  }
  if (position === "droite") {
    return `<div class="doc-head" style="flex-direction:row-reverse;text-align:${align}">${logoImg}${text}</div>`;
  }
  return `<div class="doc-head">${logoImg}${text}</div>`;
}

/**
 * Scannable barcode of a document number, printed at the foot of the sheet so
 * an order or a delivery note can be pulled up with the shop's scanner.
 */
export function documentBarcode(reference: string): string {
  const image = barcodeDataUrl(reference);
  return image ? `<img class="doc-barcode" src="${image}" alt="" />` : "";
}

/** Prints an A4 sheet (report, inventory count sheet, delivery note). */
export function printSheet(
  title: string,
  bodyHtml: string,
  options?: PrintOptions
): void {
  printDocument(title, SHEET_STYLE, options?.documentConfig ? commercialMarkup(bodyHtml, options.documentConfig) : bodyHtml, options);
}

const LABEL_STYLE = `
  :is(#receipt-print-root, body > .grid) { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0;
         padding: 6mm; }
  @page { size: A4 portrait; margin: 0; }
  :is(#receipt-print-root > .grid, body > .grid) { display: flex; flex-wrap: wrap; gap: 4mm; }
  :is(#receipt-print-root, body > .grid) .label { width: 60mm; box-sizing: border-box; border: 1px dashed #94a3b8;
           border-radius: 3mm; padding: 3mm; text-align: center;
           page-break-inside: avoid; }
  :is(#receipt-print-root, body > .grid) .shop-logo { height: 8mm; max-width: 30mm; object-fit: contain;
               display: block; margin: 0 auto 1mm; }
  :is(#receipt-print-root, body > .grid) .shop { font-size: 9px; text-transform: uppercase; letter-spacing: .08em;
          color: #64748b; margin: 0; }
  :is(#receipt-print-root, body > .grid) .name { font-size: 12px; font-weight: 700; margin: .5mm 0; }
  :is(#receipt-print-root, body > .grid) .price { font-size: 20px; font-weight: 800; margin: 0; }
  :is(#receipt-print-root, body > .grid) .wholesale { font-size: 10px; color: #334155; margin: 1mm 0 0; }
  :is(#receipt-print-root, body > .grid) .code { font-size: 9px; color: #64748b; margin: 1mm 0 0; }
  :is(#receipt-print-root, body > .grid) .qr { max-width:100%;width: 40mm; height: 13mm; min-height:3mm;flex-shrink:1;margin: 1mm auto 0; display: block;
        object-fit: contain; }
`;

/**
 * Price labels, laid out as a cuttable grid on A4. The label size comes from
 * the label printer configuration, which is independent from the receipt one.
 */
export function printLabels(
  title: string,
  labelsHtml: string,
  config: LabelPrinterConfig = DEFAULT_PRINTING.label
): void {
  printDocument(title, labelPrintStyle(config), `<div class="grid">${labelsHtml}</div>`, { printerName: config.printer_name });
}

export function labelPrintStyle(config: LabelPrinterConfig): string {
  const sizing =
    `:is(#receipt-print-root > .grid, body > .grid) {display:grid;grid-template-columns:repeat(${Math.round(printNumber(config.columns,3,1,12))},${printNumber(config.width_mm,60,20,120)}mm);}` +
    `:is(#receipt-print-root, body > .grid) .label { width: ${config.width_mm}mm;` +
    ` height: ${config.height_mm}mm;overflow:hidden;display:flex;flex-direction:column;align-items:center;` +
    ` font-family:"${printFont(config.font_family)}";font-size: ${printNumber(config.font_size,12,8,36)}px; } :is(#receipt-print-root, body > .grid) .label :is(.name,.price,.code,.shop,.wholesale) {font-size:inherit} :is(#receipt-print-root, body > .grid) .label .price{font-size:1.5em} :is(#receipt-print-root, body > .grid) .label .qr-square{width:20mm;height:20mm}`;
  return LABEL_STYLE + sizing;
}

/**
 * Applies the page geometry matching the receipt format, then prints. When
 * several copies are configured, the ticket is repeated on as many pages so a
 * single dialog produces the whole set. Resolves to true when the drawer kick
 * travelled with the ticket, so the caller knows the till is already open.
 */
export function printReceipt(
  format: ReceiptFormat,
  config: ReceiptPrinterConfig = DEFAULT_PRINTING.receipt,
  /** Cash drawer kick code, sent with the ticket on the same printer. */
  kick: number[] = [],
  options: { controlled?: boolean } = {}
): Promise<boolean> {
  let style = document.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = pageRule(format, config.margin_mm, config.paper_width_mm);
  const thermal = format === "80mm" || format === "58mm";
  // Measured before the copies are added, so every copy gets its own page.
  const pageHeight = format !== "A4" ? ticketHeightMm() : 297;
  const root = document.getElementById(PRINT_ROOT_ID);
  const copies = Math.min(Math.max(Math.round(config.copies) || 1, 1), 5);
  const extras: HTMLElement[] = [];
  const printer = config.printer_name.trim();
  const failed = (problem: unknown = "impression silencieuse indisponible ou refusée") => {
    if (options.controlled) {
      if (problem instanceof Error) throw problem;
      throw new Error(`Ticket non envoyé${printer ? ` sur ${printer}` : ""} : ${problem}`);
    }
    if (printer) {
      window.alert(`Ticket non envoyé sur ${printer} : ${problem}`);
    } else {
      window.print();
    }
    return false;
  };
  if (root && copies > 1) {
    for (let i = 1; i < copies; i += 1) {
      const copy = root.cloneNode(true) as HTMLElement;
      copy.removeAttribute("id");
      copy.classList.add("receipt-copy");
      root.appendChild(copy);
      extras.push(copy);
    }
  }
  const direct = desktopTicket();
  if (direct && thermal && root) {
    const payload = JSON.stringify({
      printer,
      copies,
      cut: config.cut_paper,
      kick,
      lines: ticketLines(root, format, config),
      line_spacing: Math.round(printNumber(config.line_height,1.35,1,2) * 24),
    });
    extras.forEach((copy) => copy.remove());
    extras.length = 0;
    return direct(payload).then((problem) => {
      if (!problem) return kick.length > 0;
      if (printer || options.controlled) return failed(problem);
      // No thermal printer on this computer: fall back on the page printer,
      // still at the ticket geometry so the roll is not padded to a sheet.
      const fallback = desktopPrint();
      if (fallback) {
        return fallback(widthMm(format), pageHeight, 0)
          .then((done) => {
            if (!done) window.print();
            return false;
          })
          .catch(() => {
            window.print();
            return false;
          });
      }
      window.print();
      return false;
    }).catch(failed);
  }
  const targeted = desktopPrintTo();
  const native = printer
    ? targeted && ((width: number, height: number, margin: number) =>
        targeted(width, height, margin, printer))
    : desktopPrint();
  if (native) {
    const width = format !== "A4" ? widthMm(format, config.paper_width_mm) : 210;
    return native(width, pageHeight, 0)
      .then((done) => {
        if (!done) return failed();
        return false;
      })
      .catch(failed)
      .finally(() => extras.forEach((copy) => copy.remove()));
  }
  failed();
  extras.forEach((copy) => copy.remove());
  return Promise.resolve(false);
}
