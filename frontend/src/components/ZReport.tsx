import { formatXOF } from "../api/client";
import type { CompanySettings, ReceiptFormat } from "../types";

export interface ZReportData {
  session_id: number;
  company: string;
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
        <p className="text-sm font-bold">{company?.name || report.company}</p>
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
