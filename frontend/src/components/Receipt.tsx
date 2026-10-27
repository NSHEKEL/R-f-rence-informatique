import { createPortal } from "react-dom";
import { formatDateTime, formatMoney } from "../api/client";
import type {
  CompanySettings,
  ReceiptFormat,
  ReceiptPrinterConfig,
  Sale,
} from "../types";
import { vatBreakdown } from "../lib/vat";
import { barcodeDataUrl } from "../lib/barcode";
import { useCompany } from "../context/CompanyContext";

interface ReceiptProps {
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
  const change = Math.max((sale.paid_amount || 0) - sale.total, 0);
  const footer =
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
        <div>
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
        </div>
      </div>

      {config.show_header && (
        <p className="receipt-title">
          {company?.receipt_header || "Reçu de caisse"}
        </p>
      )}

      {duplicate && <p className="receipt-duplicate">DUPLICATA</p>}

      <div className="receipt-meta">
        {config.show_number && (
          <>
            <span>Référence</span>
            <span>{sale.reference}</span>
          </>
        )}
        {config.show_datetime && (
          <>
            <span>Date</span>
            <span>{formatDateTime(sale.date)}</span>
          </>
        )}
        {config.show_customer && (
          <>
            <span>Client</span>
            <span>{sale.customer?.name ?? "Client de passage"}</span>
          </>
        )}
        {config.show_payment && (
          <>
            <span>Paiement</span>
            <span>{sale.payment_method}</span>
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
            {config.show_qty && <th className="qty">Qté</th>}
            {config.show_unit_price && <th className="num">P.U.</th>}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it) => (
            <tr key={it.id}>
              <td>{it.product_name}</td>
              {config.show_qty && <td className="qty">{it.quantity}</td>}
              {config.show_unit_price && (
                <td className="num">{money(it.unit_price)}</td>
              )}
              <td className="num strong">{money(it.subtotal)}</td>
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
  config,
}: ReceiptProps) {
  const { printing } = useCompany();
  const settings = config ?? printing.receipt;
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
    fontFamily: settings.font_family,
    fontSize: `${settings.font_size}px`,
    lineHeight: settings.line_height,
    textAlign: settings.align,
  } as const;
  return (
    <>
      <div
        className={`receipt receipt-preview receipt-${format}`}
        style={style}
      >
        {body}
      </div>
      {createPortal(
        <div
          id="receipt-print-root"
          className={`receipt receipt-${format}`}
          style={style}
        >
          {body}
        </div>,
        document.body
      )}
    </>
  );
}
