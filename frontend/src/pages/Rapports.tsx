import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Printer, Receipt, TrendingUp, Undo2, Wallet } from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { ReportRow, SalesReport } from "../types";
import { printSheet } from "../lib/print";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function RowTable({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: ReportRow[];
  unit?: string;
}) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-base font-bold text-slate-900">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 text-slate-600">{r.label}</td>
              {unit && (
                <td className="py-2 text-right text-slate-500">
                  {r.quantity} {unit}
                </td>
              )}
              <td className="py-2 text-right font-semibold text-slate-900">
                {formatXOF(r.amount)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="py-6 text-center text-slate-400">
                Aucune donnée sur la période.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function rowsTable(title: string, rows: ReportRow[], unit: string): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.label}</td>` +
        (unit ? `<td class="num">${r.quantity} ${unit}</td>` : "") +
        `<td class="num">${formatXOF(r.amount)}</td></tr>`
    )
    .join("");
  return (
    `<h2>${title}</h2><table><thead><tr><th>Libellé</th>` +
    (unit ? `<th class="num">Quantité</th>` : "") +
    `<th class="num">Montant</th></tr></thead><tbody>` +
    (body || `<tr><td colspan="3">Aucune donnée</td></tr>`) +
    `</tbody></table>`
  );
}

export default function Rapports() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const [start, setStart] = useState(daysAgo(29));
  const [end, setEnd] = useState(today());
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const { data } = await api.get<SalesReport>("/reports/sales", {
        params: { start, end },
      });
      if (current !== requestId.current) return;
      setReport(data);
      setError("");
    } catch (err) {
      if (current !== requestId.current) return;
      if (axios.isAxiosError(err)) {
        setReport(null);
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, [start, end]);

  useEffect(() => {
    const timer = setTimeout(load, 350);
    return () => clearTimeout(timer);
  }, [load, version]);

  function print() {
    if (!report) return;
    const period = `${new Date(report.period_start).toLocaleDateString("fr-FR")} au ${new Date(report.period_end).toLocaleDateString("fr-FR")}`;
    printSheet(
      "Rapport des ventes",
      `<h1>${company?.name ?? "Rapport des ventes"}</h1>` +
        `<p class="meta">Rapport des ventes — du ${period}</p>` +
        `<table><tbody>` +
        `<tr><td>Chiffre d'affaires</td><td class="num">${formatXOF(report.revenue)}</td></tr>` +
        `<tr><td>Nombre de ventes</td><td class="num">${report.sales_count}</td></tr>` +
        `<tr><td>Retours</td><td class="num">${formatXOF(report.returns_total)}</td></tr>` +
        `<tr><td>Revenu net</td><td class="num">${formatXOF(report.net_revenue)}</td></tr>` +
        `<tr><td>Ticket moyen</td><td class="num">${formatXOF(report.average_ticket)}</td></tr>` +
        `</tbody></table>` +
        rowsTable("Par mode de paiement", report.by_payment, "") +
        rowsTable("Par vendeuse / caissière", report.by_seller, "ventes") +
        rowsTable("Par catégorie", report.by_category, "u.") +
        rowsTable("Meilleurs articles", report.by_product, "u.")
    );
  }

  const cards = report
    ? [
        {
          label: "Chiffre d'affaires",
          value: formatXOF(report.revenue),
          icon: TrendingUp,
          tone: "text-brand-700 bg-brand-50",
        },
        {
          label: "Ventes",
          value: String(report.sales_count),
          icon: Receipt,
          tone: "text-slate-700 bg-slate-100",
        },
        {
          label: "Retours",
          value: formatXOF(report.returns_total),
          icon: Undo2,
          tone: "text-amber-700 bg-amber-50",
        },
        {
          label: "Revenu net",
          value: formatXOF(report.net_revenue),
          icon: Wallet,
          tone: "text-emerald-700 bg-emerald-50",
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-4 p-5 print:hidden">
        <div>
          <label className="label">Du</label>
          <input
            type="date"
            className="input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Au</label>
          <input
            type="date"
            className="input"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <button className="btn-primary ml-auto" onClick={print}>
          <Printer size={16} /> Imprimer le rapport
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div id="report-print" className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="card p-5">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.tone}`}
                >
                  <c.icon size={20} />
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {c.label}
                  </p>
                  <p className="text-lg font-extrabold text-slate-900">
                    {c.value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {report && (
          <div className="card p-5">
            <p className="text-sm text-slate-500">
              Ticket moyen sur la période
            </p>
            <p className="text-3xl font-extrabold text-slate-900">
              {formatXOF(report.average_ticket)}
            </p>
          </div>
        )}

        {report && report.by_day.length > 0 && (
          <div className="card p-5">
            <h3 className="mb-4 text-base font-bold text-slate-900">
              Ventes par jour
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70} />
                  <Tooltip
                    formatter={(v) => [formatXOF(Number(v)), "Ventes"]}
                  />
                  <Bar dataKey="amount" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <RowTable
            title="Par mode de paiement"
            rows={report?.by_payment ?? []}
          />
          <RowTable
            title="Par vendeuse / caissière"
            rows={report?.by_seller ?? []}
            unit="ventes"
          />
          <RowTable
            title="Par catégorie"
            rows={report?.by_category ?? []}
            unit="u."
          />
          <RowTable
            title="Meilleurs articles"
            rows={report?.by_product ?? []}
            unit="u."
          />
        </div>
      </div>
    </div>
  );
}
