import { createPortal } from "react-dom";
import { formatDateTime, formatMoney } from "../api/client";
import type {
  CompanySettings,
  ReceiptFormat,
  ReceiptPrinterConfig,
  Sale,
} from "../types";
import { vatBreakdown } from "../lib/vat";
import { barcodeDataUrl, qrDataUrl } from "../lib/barcode";
import { useCompany } from "../context/CompanyContext";
import { salePriceParts } from "../lib/units";
import { commercialStyle, printFont, printColor, printerColorAllowed } from "../lib/printStyle";

interface ReceiptProps {
  previewOnly?: boolean;
  printOnly?: boolean;
  printSourceId?: string;
  sale: Sale;
  company: CompanySettings | null;
  format: ReceiptFormat;
  /** Marks a re-print so the customer copy cannot pass for the original. */
  duplicate?: boolean;
  /** Overrides the saved configuration, used by the settings preview. */
  config?: ReceiptPrinterConfig;
}

function ReceiptBody({
  sale,
  company,
  duplicate,
  config,
}: Omit<ReceiptProps, "format"> & { config: ReceiptPrinterConfig }) {
  const currency = company?.currency || "FCFA";
  const money = (v: number) => formatMoney(v, currency);
  const vat = vatBreakdown(sale.total, company);
  const barcode = config.show_barcode ? barcodeDataUrl(sale.reference) : "";
  // QR carrying the reference and the total, so a phone scan verifies the
  // ticket; skipped entirely when the poste did not opt in.
  const qrPayload = `EG|${sale.reference}|${Math.round(sale.total)}`;
  const qr = config.show_qr ? qrDataUrl(qrPayload, 140) : "";
  const change = Math.max((sale.paid_amount || 0) - sale.total, 0);
  const footer =
    config.footer_text ||
    sale.receipt_footer ||
    company?.receipt_footer ||
    "Merci de votre confiance !";

  return (
    <>
      <div className="receipt-head">
        {config.show_logo && company?.logo && (
          <img
            src={company.logo}
            alt=""
            className="receipt-logo"
            style={{
              height: `${config.logo_size_mm}mm`,
              width: `${config.logo_size_mm}mm`,
              margin: config.logo_align === "center" ? "0 auto" : undefined,
            }}
          />
        )}
        {config.show_company_info !== false && <div>
          {config.show_company && (
            <p className="receipt-company">{company?.name}</p>
          )}
          {config.show_company && company?.slogan && (
            <p className="receipt-slogan">{company.slogan}</p>
          )}
          <div className="receipt-contact">
            {config.show_address && company?.address && (
              <p>{company.address}</p>
            )}
            {((config.show_phone && company?.phone) ||
              (config.show_email && company?.email)) && (
              <p>
                {config.show_phone ? company?.phone : ""}
                {config.show_phone &&
                company?.phone &&
                config.show_email &&
                company?.email
                  ? " · "
                  : ""}
                {config.show_email ? company?.email : ""}
              </p>
            )}
            {config.show_website && company?.website && (
              <p>{company.website}</p>
            )}
            {config.show_tax_id && company?.tax_id && (
              <p>RCCM/NCC : {company.tax_id}</p>
            )}
          </div>
        </div>}
      </div>

      {config.show_header && (
        <p className="receipt-title">
          {company?.receipt_header || "Reçu de caisse"}
        </p>
      )}

      {duplicate && <p className="receipt-duplicate">DUPLICATA</p>}
      {sale.is_gift && (
        <p className="receipt-duplicate">VENTE CADEAU — ARTICLES OFFERTS</p>
      )}

      <div className="receipt-meta">
        {config.show_number && (
          <>
            <span className="document-reference">Référence</span>
            <span className="document-reference">{sale.reference}</span>
          </>
        )}
        {config.show_datetime && (
          <>
            <span className="document-date">Date</span>
            <span className="document-date">{formatDateTime(sale.date)}</span>
          </>
        )}
        {config.show_customer && (
          <>
            <span className="customer-info">Client</span>
            <span className="customer-info">{sale.customer?.name ?? "Client de passage"}</span>
          </>
        )}
        {config.show_payment && (
          <>
            <span>Paiement</span>
            <span>{sale.is_gift ? "Offert" : sale.payment_method}</span>
          </>
        )}
        <span>Statut</span>
        <span>{sale.status}</span>
        {config.show_seller && sale.created_by?.name && (
          <>
            <span>Vendeur</span>
            <span>{sale.created_by.name}</span>
          </>
        )}
      </div>

      <table className="receipt-items">
        <thead>
          <tr>
            <th>Article</th>
            {config.show_qty && <th className="qty" data-field="qty">Qté</th>}
            {config.show_unit_price && <th className="num" data-field="price">P.U.</th>}
            {config.show_line_total !== false && <th className="num" data-field="total">Total</th>}
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it) => (
            <tr key={it.id}>
              <td>{it.product_name}</td>
              {config.show_qty && <td className="qty" data-field="qty">{it.quantity_label || it.quantity}</td>}
              {config.show_unit_price && (
                <td className="num" data-field="price">{salePriceParts(it).map((part) => <div key={part.kind}>{money(part.amount)}{part.unit && <><br /><small>/{part.unit}</small></>}</div>)}</td>
              )}
              {config.show_line_total !== false && <td className="num strong" data-field="total">{money(it.subtotal)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {config.show_discount && (sale.discount || 0) > 0 && (
        <div className="receipt-meta receipt-taxes">
          <span>Remise</span>
          <span>- {money(sale.discount)}</span>
        </div>
      )}

      {vat && (config.show_total_ht || config.show_vat) && (
        <div className="receipt-meta receipt-taxes">
          {config.show_total_ht && (
            <>
              <span>Total HT</span>
              <span>{money(vat.excluded)}</span>
            </>
          )}
          {config.show_vat && (
            <>
              <span>TVA ({vat.rate} %)</span>
              <span>{money(vat.vat)}</span>
            </>
          )}
        </div>
      )}

      {config.show_total_ttc && (
        <div className="receipt-total">
          <span>{vat ? "Total TTC" : "Total"}</span>
          <span>{money(sale.total)}</span>
        </div>
      )}

      {((config.show_paid && (sale.paid_amount || 0) > 0) ||
        (config.show_change && change > 0)) && (
        <div className="receipt-meta receipt-taxes">
          {config.show_paid && (sale.paid_amount || 0) > 0 && (
            <>
              <span>Montant payé</span>
              <span>{money(sale.paid_amount)}</span>
            </>
          )}
          {config.show_change && change > 0 && (
            <>
              <span>Monnaie rendue</span>
              <span>{money(change)}</span>
            </>
          )}
        </div>
      )}

      {barcode && (
        <img src={barcode} alt={sale.reference} className="receipt-barcode" />
      )}

      {qr && (
        <img
          src={qr}
          alt=""
          data-qr={qrPayload}
          className="receipt-qr"
        />
      )}

      {config.show_footer && <p className="receipt-footer">{footer}</p>}
    </>
  );
}

/**
 * Renders the receipt twice: an on-screen preview inside the modal, and a
 * print-only copy portaled to <body> so the printed output escapes the modal's
 * scroll container (which otherwise clipped it to a single, cut-off page).
 */
export default function Receipt({
  sale,
  company,
  format,
  duplicate,
  previewOnly = false,
  printOnly = false,
  printSourceId,
  config,
}: ReceiptProps) {
  const { printing } = useCompany();
  const original = config ?? printing.receipt;
  const raw = format === '58mm' || format === '80mm';
  const colorAllowed = !raw && printerColorAllowed(original.printer_name);
  const doc = colorAllowed ? printing.documents : { ...printing.documents, text_color: '#000000', accent_color: '#000000' };
  const settings = format === 'A4' ? {
    ...original,
    font_family: doc.font_family, font_size: doc.font_size, logo_size_mm: doc.logo_size_mm,
    show_logo: doc.show_logo, show_company: doc.show_company, show_company_info: doc.show_company,
    show_address: doc.show_address, show_phone: doc.show_phone, show_email: doc.show_email, show_website: doc.show_website,
    show_customer: doc.show_customer, show_number: doc.show_reference, show_datetime: doc.show_date,
    show_qty: doc.show_qty, show_unit_price: doc.show_unit_price, show_line_total: doc.show_total,
    show_total_ht: doc.show_total, show_total_ttc: doc.show_total, show_vat: doc.show_vat, show_discount: doc.show_discount,
    show_footer: true, footer_text: doc.footer_text || original.footer_text,
  } : original;
  const a4 = format === 'A4';
  const shared = a4 ? <><style>{commercialStyle(doc)}</style><p className="shared-header">{doc.header_text}</p></> : null;
  const body = (
    <ReceiptBody
      sale={sale}
      company={company}
      duplicate={duplicate}
      config={settings}
    />
  );
  // The ticket font, its size and its alignment are part of the printer
  // configuration: they are applied to both copies so what is previewed is
  // what comes out of the printer.
  const style = {
    fontFamily: raw ? 'monospace' : printFont(settings.font_family),
    fontSize: `${settings.font_size}px`,
    fontWeight: !a4 && settings.bold ? 700 : undefined,
    color: a4 ? printColor(doc.text_color) : colorAllowed ? printColor(settings.text_color) : '#000000',
    width: format === 'custom' ? `${settings.paper_width_mm}mm` : undefined,
    lineHeight: a4 ? 1.5 : settings.line_height,
    textAlign: a4 ? 'left' : settings.align,
  } as const;
  return (
    <>
      {!printOnly && <div
        className={`receipt receipt-preview receipt-${format} ${a4 ? 'commercial-document' : ''} ${settings.item_layout === 'stacked' ? 'receipt-stacked' : ''}`}
        style={style}
      >
        {shared}{body}
      </div>}
      {!previewOnly && createPortal(
        <div
          id={printSourceId || "receipt-print-root"}
          className={`receipt receipt-${format} ${a4 ? 'commercial-document' : ''} ${settings.item_layout === 'stacked' ? 'receipt-stacked' : ''}`}
          style={{ ...style, ...(printSourceId ? { display: "none" } : {}) }}
        >
          {shared}{body}
        </div>,
        document.body
      )}
    </>
  );
}
