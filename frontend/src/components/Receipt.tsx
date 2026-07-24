import logo from "../assets/logo.jpg";
import { formatDate, formatMoney } from "../api/client";
import type { CompanySettings, Sale } from "../types";

interface ReceiptProps {
  sale: Sale;
  company: CompanySettings | null;
}

export default function Receipt({ sale, company }: ReceiptProps) {
  const currency = company?.currency || "FCFA";
  const money = (v: number) => formatMoney(v, currency);
  const footer =
    sale.receipt_footer ||
    company?.receipt_footer ||
    "Merci de votre confiance !";

  return (
    <div
      id="receipt-print"
      className="mx-auto max-w-md bg-white p-6 text-slate-900"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-dashed border-slate-300 pb-4">
        <img
          src={logo}
          alt="Logo"
          className="h-14 w-14 shrink-0 object-contain"
        />
        <div className="leading-tight">
          <p className="text-lg font-extrabold uppercase tracking-tight">
            {company?.name || "Référence Informatique"}
          </p>
          {company?.slogan && (
            <p className="text-xs italic text-slate-500">{company.slogan}</p>
          )}
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
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

      {/* Title */}
      <div className="py-3 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-slate-700">
          {company?.receipt_header || "Reçu de caisse"}
        </p>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-y border-dashed border-slate-300 py-3 text-xs">
        <p className="text-slate-500">Référence</p>
        <p className="text-right font-semibold">{sale.reference}</p>
        <p className="text-slate-500">Date</p>
        <p className="text-right font-semibold">{formatDate(sale.date)}</p>
        <p className="text-slate-500">Client</p>
        <p className="text-right font-semibold">
          {sale.customer?.name ?? "Client de passage"}
        </p>
        <p className="text-slate-500">Paiement</p>
        <p className="text-right font-semibold">{sale.payment_method}</p>
        <p className="text-slate-500">Statut</p>
        <p className="text-right font-semibold">{sale.status}</p>
        {sale.created_by?.name && (
          <>
            <p className="text-slate-500">Vendeur</p>
            <p className="text-right font-semibold">{sale.created_by.name}</p>
          </>
        )}
      </div>

      {/* Items */}
      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="border-b border-slate-300 text-left text-[10px] uppercase text-slate-500">
            <th className="py-1">Article</th>
            <th className="py-1 text-center">Qté</th>
            <th className="py-1 text-right">P.U.</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it) => (
            <tr key={it.id} className="border-b border-dashed border-slate-200">
              <td className="py-1.5 pr-2">{it.product_name}</td>
              <td className="py-1.5 text-center">{it.quantity}</td>
              <td className="py-1.5 text-right">{money(it.unit_price)}</td>
              <td className="py-1.5 text-right font-medium">
                {money(it.subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Total */}
      <div className="mt-3 flex items-center justify-between border-t-2 border-slate-800 pt-2">
        <span className="text-sm font-bold uppercase">Total</span>
        <span className="text-lg font-extrabold">{money(sale.total)}</span>
      </div>

      {sale.note && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          {sale.note}
        </p>
      )}

      {/* Footer */}
      <p className="mt-5 whitespace-pre-line border-t border-dashed border-slate-300 pt-3 text-center text-xs font-medium text-slate-600">
        {footer}
      </p>
    </div>
  );
}
