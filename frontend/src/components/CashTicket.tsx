import { createPortal } from "react-dom";
import { formatMoney } from "../api/client";
import type { CashSessionDetail, CompanySettings, ReceiptFormat } from "../types";

export type CashTicketKind = "open" | "close";

interface CashTicketProps {
  session: CashSessionDetail;
  company: CompanySettings | null;
  format: ReceiptFormat;
  kind: CashTicketKind;
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TicketBody({
  session,
  company,
  kind,
}: Omit<CashTicketProps, "format">) {
  const currency = company?.currency || "FCFA";
  const money = (v: number) => formatMoney(v, currency);
  const closing = kind === "close";

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
          <div className="receipt-contact">
            {company?.address && <p>{company.address}</p>}
            {company?.phone && <p>{company.phone}</p>}
          </div>
        </div>
      </div>

      <p className="receipt-title">
        {closing ? "Fermeture de caisse" : "Ouverture de caisse"}
      </p>

      <div className="receipt-meta">
        <span>Caissier</span>
        <span>
          {(closing ? session.closed_by?.name : session.opened_by?.name) ?? "—"}
        </span>
        <span>Journée</span>
        <span>{session.business_day}</span>
        <span>Ouverture</span>
        <span>{dateTime(session.opened_at)}</span>
        {closing && session.closed_at && (
          <>
            <span>Fermeture</span>
            <span>{dateTime(session.closed_at)}</span>
          </>
        )}
      </div>

      <table className="receipt-items">
        <tbody>
          <tr>
            <td>Fonds d'ouverture</td>
            <td className="num strong">{money(session.opening_balance)}</td>
          </tr>
          {closing && (
            <>
              <tr>
                <td>Ventes espèces</td>
                <td className="num strong">{money(session.cash_sales)}</td>
              </tr>
              <tr>
                <td>Autres paiements</td>
                <td className="num strong">{money(session.other_sales)}</td>
              </tr>
              <tr>
                <td>Tickets encaissés</td>
                <td className="num strong">{session.sales_count}</td>
              </tr>
              <tr>
                <td>Solde attendu</td>
                <td className="num strong">
                  {money(session.expected_balance ?? session.expected_cash)}
                </td>
              </tr>
              <tr>
                <td>Solde compté</td>
                <td className="num strong">
                  {money(session.closing_balance ?? 0)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {closing && (
        <div className="receipt-total">
          <span>Écart</span>
          <span>{money(session.difference ?? 0)}</span>
        </div>
      )}

      {session.note && <p className="receipt-note">{session.note}</p>}

      <p className="receipt-footer">
        Signature : ______________________
      </p>
    </>
  );
}

/** Same print pipeline as the sale receipt: preview + portaled print copy. */
export default function CashTicket({
  session,
  company,
  format,
  kind,
}: CashTicketProps) {
  const body = <TicketBody session={session} company={company} kind={kind} />;
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
