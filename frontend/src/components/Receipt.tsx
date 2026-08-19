import { createPortal } from "react-dom";
import { formatDateTime, formatMoney } from "../api/client";
import type { CompanySettings, ReceiptFormat, Sale } from "../types";
import { vatBreakdown } from "../lib/vat";

interface ReceiptProps {
  sale: Sale;
  company: CompanySettings | null;
  format: ReceiptFormat;
  /** Marks a re-print so the customer copy cannot pass for the original. */
  duplicate?: boolean;
}

function ReceiptBody({
  sale,
  company,
  duplicate,
}: Omit<ReceiptProps, "format">) {
  const currency = company?.currency || "FCFA";
  const money = (v: number) => formatMoney(v, currency);
  const vat = vatBreakdown(sale.total, company);
  const footer =
    sale.receipt_footer ||
    company?.receipt_footer ||
    "Merci de votre confiance !";

  return (
    <>
      <div className="receipt-head">
        {company?.logo && (
          <img src={company.logo} alt="" className="receipt-logo" />
        )}
        <div>
          <p className="receipt-company">
            {company?.name}
          </p>
          {company?.slogan && <p className="receipt-slogan">{company.slogan}</p>}
          <div className="receipt-contact">
            {company?.address && <p>{company.address}</p>}
            {(company?.phone || company?.email) && (
              <p>
                {company?.phone}
                {company?.phone && company?.email ? " · " : ""}
                {company?.email}
              </p>
            )}
            {company?.website && <p>{company.website}</p>}
            {company?.tax_id && <p>RCCM/NCC : {company.tax_id}</p>}
          </div>
        </div>
      </div>

      <p className="receipt-title">
        {company?.receipt_header || "Reçu de caisse"}
      </p>

      {duplicate && <p className="receipt-duplicate">DUPLICATA</p>}

      <div className="receipt-meta">
        <span>Référence</span>
        <span>{sale.reference}</span>
        <span>Date</span>
        <span>{formatDateTime(sale.date)}</span>
        <span>Client</span>
        <span>{sale.customer?.name ?? "Client de passage"}</span>
        <span>Paiement</span>
        <span>{sale.payment_method}</span>
        <span>Statut</span>
        <span>{sale.status}</span>
        {sale.created_by?.name && (
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
            <th className="qty">Qté</th>
            <th className="num">P.U.</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it) => (
            <tr key={it.id}>
              <td>{it.product_name}</td>
              <td className="qty">{it.quantity}</td>
              <td className="num">{money(it.unit_price)}</td>
              <td className="num strong">{money(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {vat && (
        <div className="receipt-meta receipt-taxes">
          <span>Total HT</span>
          <span>{money(vat.excluded)}</span>
          <span>TVA ({vat.rate} %)</span>
          <span>{money(vat.vat)}</span>
        </div>
      )}

      <div className="receipt-total">
        <span>{vat ? "Total TTC" : "Total"}</span>
        <span>{money(sale.total)}</span>
      </div>

      {sale.note && <p className="receipt-note">{sale.note}</p>}

      <p className="receipt-footer">{footer}</p>
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
}: ReceiptProps) {
  const body = (
    <ReceiptBody sale={sale} company={company} duplicate={duplicate} />
  );
  return (
    <>
      <div className={`receipt receipt-preview receipt-${format}`}>{body}</div>
      {createPortal(
        <div id="receipt-print-root" className={`receipt receipt-${format}`}>
          {body}
        </div>,
        document.body
      )}
    </>
  );
}
