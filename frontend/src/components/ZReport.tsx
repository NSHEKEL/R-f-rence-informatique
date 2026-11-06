import { formatXOF } from "../api/client";
import type { CompanySettings, ReceiptFormat } from "../types";

export interface ZReportData {
  session_id: number;
  company: string;
  company_address?: string;
  company_phone?: string;
  company_logo?: string;
  cashier: string;
  opened_at: string | null;
  closed_at: string | null;
  business_day: string;
  opening_balance: number;
  total_sales: number;
  sales_count: number;
  cancelled_total: number;
  cancelled_count: number;
  gift_total: number;
  payments: Record<string, number>;
  refunds_total?: number;
  refunds?: { reference: string; sale_reference: string; total: number }[];
  advances_total?: number;
  advances?: { reference: string; customer: string; amount: number }[];
  settlements_total?: number;
  settlements?: Record<string, number>;
  expenses_total: number;
  expenses: { label: string; category: string; amount: number }[];
  deposits_total: number;
  deposits: { id: number; amount: number; bank: string; status: string }[];
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  note: string;
  generated_at: string | null;
}

function dt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

/** État Z de caisse — définitive recap of a till session, printable. */
export default function ZReport({
  report,
  company,
  format,
}: {
  report: ZReportData;
  company: CompanySettings | null;
  format: ReceiptFormat;
}) {
  const methods = Object.entries(report.payments);
  return (
    <div id="receipt-print-root" className={`receipt receipt-${format}`}>
      <div className="text-center">
        {(company?.logo || report.company_logo) && (
          <img
            src={company?.logo || report.company_logo}
            alt=""
            className="mx-auto mb-1 max-h-14 object-contain"
          />
        )}
        <p className="text-sm font-bold">{company?.name || report.company}</p>
        {(company?.address || report.company_address) && (
          <p className="text-[10px]">
            {company?.address || report.company_address}
          </p>
        )}
        {(company?.phone || report.company_phone) && (
          <p className="text-[10px]">
            {company?.phone || report.company_phone}
          </p>
        )}
        <p className="text-xs font-bold">ÉTAT Z DE CAISSE</p>
        <p className="text-[10px]">Session #{report.session_id}</p>
      </div>
      <hr className="my-2 border-dashed" />
      <Row label="Caissier" value={report.cashier || "—"} />
      <Row label="Journée" value={report.business_day || "—"} />
      <Row label="Ouverture" value={dt(report.opened_at)} />
      <Row label="Clôture" value={dt(report.closed_at)} />
      <hr className="my-2 border-dashed" />
      <Row label="Fonds d'ouverture" value={formatXOF(report.opening_balance)} />
      <Row
        label={`Total des ventes (${report.sales_count})`}
        value={formatXOF(report.total_sales)}
      />
      <Row
        label={`Retours / annulations (${report.cancelled_count})`}
        value={formatXOF(report.cancelled_total)}
      />
      {report.gift_total > 0 && (
        <Row label="Ventes cadeaux" value={formatXOF(report.gift_total)} />
      )}
      <hr className="my-2 border-dashed" />
      <p className="text-[10px] font-bold uppercase">Encaissements par mode</p>
      {methods.map(([method, amount]) => (
        <Row key={method} label={method} value={formatXOF(amount)} />
      ))}
      {methods.length === 0 && <Row label="Aucun encaissement" value="—" />}
      {(report.refunds?.length ?? 0) > 0 && (
        <>
          <hr className="my-2 border-dashed" />
          <p className="text-[10px] font-bold uppercase">
            Remboursements / retours
          </p>
          {report.refunds!.map((r) => (
            <Row
              key={r.reference}
              label={`${r.reference} (${r.sale_reference})`}
              value={formatXOF(r.total)}
            />
          ))}
          <Row
            label="Total remboursements"
            value={formatXOF(report.refunds_total ?? 0)}
          />
        </>
      )}
      {(report.advances?.length ?? 0) > 0 && (
        <>
          <hr className="my-2 border-dashed" />
          <p className="text-[10px] font-bold uppercase">Acomptes reçus</p>
          {report.advances!.map((a) => (
            <Row
              key={a.reference}
              label={`${a.reference} — ${a.customer}`}
              value={formatXOF(a.amount)}
            />
          ))}
          <Row
            label="Total acomptes"
            value={formatXOF(report.advances_total ?? 0)}
          />
        </>
      )}
      {report.settlements &&
        Object.keys(report.settlements).length > 0 && (
          <>
            <hr className="my-2 border-dashed" />
            <p className="text-[10px] font-bold uppercase">
              Règlements de créances
            </p>
            {Object.entries(report.settlements).map(([method, amount]) => (
              <Row key={method} label={method} value={formatXOF(amount)} />
            ))}
            <Row
              label="Total règlements"
              value={formatXOF(report.settlements_total ?? 0)}
            />
          </>
        )}
      {report.expenses.length > 0 && (
        <>
          <hr className="my-2 border-dashed" />
          <p className="text-[10px] font-bold uppercase">Dépenses de caisse</p>
          {report.expenses.map((e, i) => (
            <Row key={i} label={e.label} value={formatXOF(e.amount)} />
          ))}
          <Row label="Total dépenses" value={formatXOF(report.expenses_total)} />
        </>
      )}
      {report.deposits.length > 0 && (
        <>
          <hr className="my-2 border-dashed" />
          <p className="text-[10px] font-bold uppercase">Versements bancaires</p>
          {report.deposits.map((d) => (
            <Row
              key={d.id}
              label={`${d.bank || "Banque"} (${d.status})`}
              value={formatXOF(d.amount)}
            />
          ))}
          <Row
            label="Total versé (validé)"
            value={formatXOF(report.deposits_total)}
          />
        </>
      )}
      <hr className="my-2 border-dashed" />
      <Row label="Montant théorique" value={formatXOF(report.expected_cash)} />
      <Row
        label="Montant compté"
        value={
          report.counted_cash === null ? "—" : formatXOF(report.counted_cash)
        }
      />
      <Row
        label="Écart"
        value={
          report.difference === null ? "—" : formatXOF(report.difference)
        }
      />
      {report.note && (
        <p className="mt-1 text-[10px]">Note : {report.note}</p>
      )}
      <hr className="my-2 border-dashed" />
      <p className="text-center text-[10px]">
        Généré le {dt(report.generated_at)} — EasyGest
      </p>
    </div>
  );
}
