import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Download,
  HandCoins,
  Plus,
  Printer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api, { formatMoney } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { exportCsv, stampedName } from "../lib/exportCsv";
import { printPaymentReceipt } from "../lib/paymentReceipt";
import { printSheet } from "../lib/print";

/**
 * Debts and receivables: what the customers still owe, what the shop owes.
 *
 * A sale paid later opens its receivable by itself; everything else is
 * written down here. Settlements are kept one by one, are never overwritten
 * and a wrong one is cancelled with its reason rather than erased.
 */

interface Payment {
  id: number;
  debt_id: number;
  amount: number;
  date: string;
  method: string;
  note: string;
  reference: string;
  receipt_reference: string;
  cancelled: boolean;
  cancel_reason: string;
  cancelled_at: string | null;
  created_by?: { name: string } | null;
  cancelled_by?: { name: string } | null;
}

interface Settlement extends Payment {
  kind: string;
  party: string;
  document: string;
}

interface Debt {
  id: number;
  kind: string;
  party: string;
  reference: string;
  amount: number;
  due_date: string | null;
  note: string;
  created_at: string;
  paid: number;
  remaining: number;
  settled: boolean;
  overdue: boolean;
  status: string;
  days_late: number;
  payments: Payment[];
}

interface Summary {
  receivable_total: number;
  receivable_overdue: number;
  receivable_count: number;
  payable_total: number;
  payable_overdue: number;
  payable_count: number;
  collected: number;
  disbursed: number;
}

interface Balance {
  party: string;
  phone: string;
  total: number;
  paid: number;
  remaining: number;
  overdue: number;
  days_late: number;
  next_due: string | null;
}

interface Alert {
  level: string;
  message: string;
}

const METHODS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement", "Chèque"];
const ALERT_DAYS = [3, 7, 15, 30];
const EMPTY = {
  kind: "creance",
  party: "",
  reference: "",
  amount: "",
  due_date: "",
  note: "",
};
const NO_PAYMENT = { amount: "", method: METHODS[0], reference: "", note: "" };

type Tab = "tableau" | "creance" | "dette" | "reglements" | "etats";

function day(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

/** First day of the current month, the default period of the dashboard. */
function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function statusClass(debt: Debt): string {
  if (debt.settled) return "bg-emerald-100 text-emerald-700";
  if (debt.overdue) return "bg-red-100 text-red-700";
  return debt.paid > 0
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";
}

export default function Dettes() {
  const { can } = useAuth();
  const { company, printing } = useCompany();
  const [tab, setTab] = useState<Tab>("tableau");
  const [rows, setRows] = useState<Debt[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertDays, setAlertDays] = useState(7);
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("ouvertes");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [reportKind, setReportKind] = useState("creance");
  const [form, setForm] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState(0);
  const [payment, setPayment] = useState({ ...NO_PAYMENT });
  const [message, setMessage] = useState("");

  const kind = tab === "dette" ? "dette" : "creance";
  const receivable = kind === "creance";
  const reportReceivable = reportKind === "creance";

  const load = useCallback(async () => {
    try {
      const [list, totals, history, owing, notices] = await Promise.all([
        api.get<Debt[]>("/debts", { params: { kind, status, search } }),
        api.get<Summary>("/debts/resume", { params: { start, end } }),
        api.get<Settlement[]>("/debts/reglements", {
          params: { start, end, method },
        }),
        api.get<Balance[]>("/debts/soldes", {
          params: { kind: tab === "etats" ? reportKind : kind },
        }),
        api.get<Alert[]>("/debts/alertes", { params: { days: alertDays } }),
      ]);
      setRows(list.data);
      setSummary(totals.data);
      setSettlements(history.data);
      setBalances(owing.data);
      setAlerts(notices.data);
    } catch {
      setMessage("Chargement impossible.");
    }
  }, [kind, status, search, start, end, method, alertDays, tab, reportKind]);

  useEffect(() => {
    void load();
  }, [load]);

  function fail(error: unknown, fallback: string) {
    setMessage(
      axios.isAxiosError(error) && typeof error.response?.data?.detail === "string"
        ? error.response.data.detail
        : fallback
    );
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api.post("/debts", {
        kind,
        party: form.party,
        reference: form.reference,
        amount: Number(form.amount),
        due_date: form.due_date ? `${form.due_date}T00:00:00` : null,
        note: form.note,
      });
      setForm({ ...EMPTY, kind });
      setAdding(false);
      setMessage("");
      await load();
    } catch (error) {
      fail(error, "Enregistrement impossible.");
    }
  }

  async function settle(debt: Debt, event: React.FormEvent) {
    event.preventDefault();
    try {
      const res = await api.post<Debt>(`/debts/${debt.id}/paiements`, {
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference,
        note: payment.note,
      });
      setPayment({ ...NO_PAYMENT });
      setMessage("");
      const saved = res.data;
      const last = saved.payments[saved.payments.length - 1];
      if (last && can("dettes_recu")) receipt(last, saved);
      await load();
    } catch (error) {
      fail(error, "Règlement impossible.");
    }
  }

  function receipt(row: Payment, debt: Debt, thermal = false) {
    printPaymentReceipt(
      row,
      {
        kind: debt.kind,
        party: debt.party,
        reference: debt.reference,
        amount: debt.amount,
        paid: debt.paid,
        remaining: debt.remaining,
      },
      company,
      thermal,
      printing.receipt.width
    );
  }

  async function cancelPayment(debt: Debt, row: Payment) {
    const reason = prompt("Motif de l'annulation de ce règlement :");
    if (reason === null) return;
    try {
      await api.post(`/debts/${debt.id}/paiements/${row.id}/annuler`, {
        reason,
      });
      setMessage("");
      await load();
    } catch (error) {
      fail(error, "Annulation impossible.");
    }
  }

  async function remove(debt: Debt) {
    if (!confirm(`Supprimer l'écriture de ${debt.party || "—"} ?`)) return;
    try {
      await api.delete(`/debts/${debt.id}`);
      await load();
    } catch (error) {
      fail(error, "Suppression impossible.");
    }
  }

  async function exportSettlements() {
    await exportCsv(
      stampedName("reglements"),
      ["Reçu", "Date", "Type", "Tiers", "Document", "Mode", "Montant", "État"],
      settlements.map((row) => [
        row.receipt_reference,
        day(row.date),
        row.kind === "dette" ? "Dette" : "Créance",
        row.party,
        row.document,
        row.method,
        row.amount,
        row.cancelled ? "Annulé" : "Valide",
      ])
    );
  }

  async function exportBalances() {
    await exportCsv(
      stampedName(
        reportReceivable ? "creances-clients" : "dettes-fournisseurs"
      ),
      ["Tiers", "Téléphone", "Total", "Réglé", "Reste", "En retard", "Échéance"],
      balances.map((row) => [
        row.party,
        row.phone,
        row.total,
        row.paid,
        row.remaining,
        row.overdue,
        day(row.next_due),
      ])
    );
  }

  function printBalances() {
    const title = reportReceivable
      ? "État des créances clients"
      : "État des dettes fournisseurs";
    const body =
      `<h2>${title}</h2>` +
      `<p class="meta">Période : ${day(start)} au ${day(end)}</p>` +
      "<table><thead><tr><th>Tiers</th><th>Total</th><th>Réglé</th>" +
      "<th>Reste</th><th>En retard</th><th>Échéance</th></tr></thead><tbody>" +
      balances
        .map(
          (row) =>
            `<tr><td>${row.party}</td><td>${formatMoney(row.total)}</td>` +
            `<td>${formatMoney(row.paid)}</td>` +
            `<td>${formatMoney(row.remaining)}</td>` +
            `<td>${formatMoney(row.overdue)}</td>` +
            `<td>${day(row.next_due)}</td></tr>`
        )
        .join("") +
      `<tr><td><b>Total</b></td><td></td><td></td><td><b>${formatMoney(
        balances.reduce((sum, row) => sum + row.remaining, 0)
      )}</b></td><td><b>${formatMoney(
        balances.reduce((sum, row) => sum + row.overdue, 0)
      )}</b></td><td></td></tr>` +
      "</tbody></table>";
    printSheet(title, body);
  }

  /** Settlements grouped by day, to see the cash coming in and going out. */
  const chart = useMemo(() => {
    const days = new Map<string, { jour: string; Encaissé: number; Payé: number }>();
    for (const row of settlements) {
      if (row.cancelled) continue;
      const key = row.date.slice(0, 10);
      const entry = days.get(key) ?? {
        jour: day(row.date),
        Encaissé: 0,
        Payé: 0,
      };
      if (row.kind === "dette") entry.Payé += row.amount;
      else entry.Encaissé += row.amount;
      days.set(key, entry);
    }
    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);
  }, [settlements]);

  const cards = [
    {
      label: "Créances clients",
      value: summary?.receivable_total ?? 0,
      hint: `${summary?.receivable_count ?? 0} écriture(s)`,
      icon: <HandCoins className="text-brand-600" />,
    },
    {
      label: "Dettes fournisseurs",
      value: summary?.payable_total ?? 0,
      hint: `${summary?.payable_count ?? 0} écriture(s)`,
      icon: <Wallet className="text-amber-600" />,
    },
    {
      label: "Créances en retard",
      value: summary?.receivable_overdue ?? 0,
      hint: "échéance dépassée",
      icon: <AlertTriangle className="text-red-600" />,
    },
    {
      label: "Dettes en retard",
      value: summary?.payable_overdue ?? 0,
      hint: "échéance dépassée",
      icon: <CalendarClock className="text-red-600" />,
    },
    {
      label: "Total encaissé",
      value: summary?.collected ?? 0,
      hint: "sur la période",
      icon: <TrendingUp className="text-emerald-600" />,
    },
    {
      label: "Payé aux fournisseurs",
      value: summary?.disbursed ?? 0,
      hint: "sur la période",
      icon: <TrendingDown className="text-slate-600" />,
    },
  ];

  const TABS: [Tab, string][] = [
    ["tableau", "Tableau de bord"],
    ["creance", "Créances clients"],
    ["dette", "Dettes fournisseurs"],
    ["reglements", "Règlements"],
    ["etats", "États"],
  ];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1 text-sm ${
                tab === value
                  ? "bg-white font-semibold shadow dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <input
            className="input w-auto"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <span className="text-slate-400">au</span>
          <input
            className="input w-auto"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, index) => (
            <div
              key={index}
              className={`card flex items-center gap-2 p-3 text-sm ${
                alert.level === "warning"
                  ? "border-l-4 border-red-500 text-red-700 dark:text-red-300"
                  : "border-l-4 border-amber-400 text-amber-700 dark:text-amber-300"
              }`}
            >
              <AlertTriangle size={16} />
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {tab === "tableau" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <div key={card.label} className="card flex items-center gap-3 p-4">
                {card.icon}
                <div>
                  <p className="text-sm text-slate-500">{card.label}</p>
                  <p className="text-xl font-bold">{formatMoney(card.value)}</p>
                  <p className="text-xs text-slate-400">{card.hint}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Encaissements et paiements</h2>
              <label className="ml-auto text-xs text-slate-500">
                Alerte avant échéance
              </label>
              <select
                className="input w-auto"
                value={alertDays}
                onChange={(e) => setAlertDays(Number(e.target.value))}
              >
                {ALERT_DAYS.map((value) => (
                  <option key={value} value={value}>
                    {value} jours
                  </option>
                ))}
              </select>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="jour" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip
                    formatter={(value) => formatMoney(Number(value ?? 0))}
                  />
                  <Legend />
                  <Bar dataKey="Encaissé" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Payé" fill="#d97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {(tab === "creance" || tab === "dette") && (
        <>
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="ouvertes">Non soldées</option>
                <option value="retard">En retard</option>
                <option value="soldees">Soldées</option>
                <option value="">Toutes</option>
              </select>
              <input
                className="input w-56"
                placeholder="Nom ou référence"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {can("dettes_gerer") && (
                <button
                  className="btn-primary ml-auto flex items-center gap-2"
                  onClick={() => {
                    setForm({ ...EMPTY, kind });
                    setAdding((open) => !open);
                  }}
                >
                  <Plus size={16} />
                  {receivable ? "Nouvelle créance" : "Nouvelle dette"}
                </button>
              )}
            </div>

            {adding && (
              <form
                onSubmit={create}
                className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-5 dark:border-slate-700"
              >
                <input
                  className="input"
                  placeholder={receivable ? "Client" : "Fournisseur"}
                  value={form.party}
                  onChange={(e) => setForm({ ...form, party: e.target.value })}
                  required
                />
                <input
                  className="input"
                  placeholder="Référence (facture, ticket)"
                  value={form.reference}
                  onChange={(e) =>
                    setForm({ ...form, reference: e.target.value })
                  }
                />
                <input
                  className="input"
                  type="number"
                  min="1"
                  placeholder="Montant"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
                <input
                  className="input"
                  type="date"
                  title="Date d'échéance"
                  value={form.due_date}
                  onChange={(e) =>
                    setForm({ ...form, due_date: e.target.value })
                  }
                />
                <button className="btn-primary">Enregistrer</button>
              </form>
            )}

            {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="p-3">{receivable ? "Client" : "Fournisseur"}</th>
                  <th className="p-3">Référence</th>
                  <th className="p-3">Montant</th>
                  <th className="p-3">Réglé</th>
                  <th className="p-3">Reste</th>
                  <th className="p-3">Échéance</th>
                  <th className="p-3">Statut</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((debt) => (
                  <Fragment key={debt.id}>
                    <tr
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => setOpened(opened === debt.id ? 0 : debt.id)}
                    >
                      <td className="p-3 font-medium">{debt.party || "—"}</td>
                      <td className="p-3">{debt.reference || "—"}</td>
                      <td className="p-3">{formatMoney(debt.amount)}</td>
                      <td className="p-3 text-emerald-700">
                        {formatMoney(debt.paid)}
                      </td>
                      <td
                        className={`p-3 font-semibold ${
                          debt.settled
                            ? "text-slate-400"
                            : debt.overdue
                              ? "text-red-600"
                              : ""
                        }`}
                      >
                        {debt.settled ? "Soldée" : formatMoney(debt.remaining)}
                      </td>
                      <td className="p-3">
                        {day(debt.due_date)}
                        {debt.days_late > 0 && (
                          <span className="ml-1 text-xs text-red-600">
                            +{debt.days_late} j
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(debt)}`}
                        >
                          {debt.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {can("dettes_gerer") && !debt.payments.length && (
                          <button
                            title="Supprimer"
                            onClick={(event) => {
                              event.stopPropagation();
                              void remove(debt);
                            }}
                          >
                            <Trash2 size={16} className="text-red-500" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {opened === debt.id && (
                      <tr className="bg-slate-50 dark:bg-slate-800">
                        <td colSpan={8} className="p-3">
                          <div className="space-y-2">
                            {debt.payments.length ? (
                              <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                {debt.payments.map((row) => (
                                  <li
                                    key={row.id}
                                    className="flex flex-wrap items-center gap-2"
                                  >
                                    <span
                                      className={
                                        row.cancelled
                                          ? "text-slate-400 line-through"
                                          : ""
                                      }
                                    >
                                      {row.receipt_reference} — {day(row.date)} —{" "}
                                      {formatMoney(row.amount)} ({row.method})
                                      {row.created_by?.name
                                        ? ` — ${row.created_by.name}`
                                        : ""}
                                    </span>
                                    {row.cancelled && (
                                      <span className="text-red-600">
                                        annulé : {row.cancel_reason}
                                        {row.cancelled_by?.name
                                          ? ` (${row.cancelled_by.name})`
                                          : ""}
                                      </span>
                                    )}
                                    {can("dettes_recu") && (
                                      <button
                                        title="Reçu A4"
                                        onClick={() => receipt(row, debt)}
                                      >
                                        <Printer
                                          size={14}
                                          className="text-brand-600"
                                        />
                                      </button>
                                    )}
                                    {can("dettes_recu") && (
                                      <button
                                        className="text-[11px] text-brand-600 underline"
                                        onClick={() => receipt(row, debt, true)}
                                      >
                                        ticket
                                      </button>
                                    )}
                                    {!row.cancelled && can("dettes_annuler") && (
                                      <button
                                        title="Annuler ce règlement"
                                        onClick={() => void cancelPayment(debt, row)}
                                      >
                                        <Ban size={14} className="text-red-500" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-slate-500">
                                Aucun règlement enregistré.
                              </p>
                            )}
                            {!debt.settled && can("dettes_regler") && (
                              <form
                                onSubmit={(event) => settle(debt, event)}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input
                                  className="input w-40"
                                  type="number"
                                  min="1"
                                  max={debt.remaining}
                                  placeholder={`Max ${formatMoney(debt.remaining)}`}
                                  value={payment.amount}
                                  onChange={(e) =>
                                    setPayment({
                                      ...payment,
                                      amount: e.target.value,
                                    })
                                  }
                                  required
                                />
                                <select
                                  className="input w-44"
                                  value={payment.method}
                                  onChange={(e) =>
                                    setPayment({
                                      ...payment,
                                      method: e.target.value,
                                    })
                                  }
                                >
                                  {METHODS.map((item) => (
                                    <option key={item}>{item}</option>
                                  ))}
                                </select>
                                <input
                                  className="input w-44"
                                  placeholder="Référence du paiement"
                                  value={payment.reference}
                                  onChange={(e) =>
                                    setPayment({
                                      ...payment,
                                      reference: e.target.value,
                                    })
                                  }
                                />
                                <button className="btn-primary">
                                  Enregistrer le règlement
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-500">
                      Aucune écriture.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "reglements" && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <select
              className="input w-auto"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">Tous les modes</option>
              {METHODS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            {can("rapports_exporter") && (
              <button
                className="btn-secondary ml-auto flex items-center gap-2"
                onClick={() => void exportSettlements()}
              >
                <Download size={16} /> Exporter
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="p-3">Reçu</th>
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Tiers</th>
                <th className="p-3">Document</th>
                <th className="p-3">Mode</th>
                <th className="p-3">Montant</th>
                <th className="p-3">Encaissé par</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 dark:border-slate-700 ${
                    row.cancelled ? "text-slate-400 line-through" : ""
                  }`}
                >
                  <td className="p-3">{row.receipt_reference || "—"}</td>
                  <td className="p-3">{day(row.date)}</td>
                  <td className="p-3">
                    {row.kind === "dette" ? "Dette" : "Créance"}
                  </td>
                  <td className="p-3 font-medium">{row.party || "—"}</td>
                  <td className="p-3">{row.document || "—"}</td>
                  <td className="p-3">{row.method}</td>
                  <td className="p-3 font-semibold">{formatMoney(row.amount)}</td>
                  <td className="p-3">{row.created_by?.name ?? "—"}</td>
                </tr>
              ))}
              {!settlements.length && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    Aucun règlement sur la période.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "etats" && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {[
                ["creance", "Clients débiteurs"],
                ["dette", "Fournisseurs à payer"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setReportKind(value)}
                  className={`rounded-md px-3 py-1 text-sm ${
                    reportKind === value
                      ? "bg-white font-semibold shadow dark:bg-slate-700"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {can("rapports_exporter") && (
              <>
                <button
                  className="btn-secondary ml-auto flex items-center gap-2"
                  onClick={printBalances}
                >
                  <Printer size={16} /> Imprimer
                </button>
                <button
                  className="btn-secondary flex items-center gap-2"
                  onClick={() => void exportBalances()}
                >
                  <Download size={16} /> Exporter
                </button>
              </>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="p-3">
                  {reportReceivable ? "Client" : "Fournisseur"}
                </th>
                <th className="p-3">Téléphone</th>
                <th className="p-3">Total</th>
                <th className="p-3">Réglé</th>
                <th className="p-3">Reste</th>
                <th className="p-3">En retard</th>
                <th className="p-3">Prochaine échéance</th>
              </tr>
            </thead>
            <tbody>
              {[...balances]
                .sort((a, b) => b.remaining - a.remaining)
                .map((row) => (
                  <tr
                    key={row.party}
                    className="border-t border-slate-100 dark:border-slate-700"
                  >
                    <td className="p-3 font-medium">{row.party}</td>
                    <td className="p-3">{row.phone || "—"}</td>
                    <td className="p-3">{formatMoney(row.total)}</td>
                    <td className="p-3 text-emerald-700">
                      {formatMoney(row.paid)}
                    </td>
                    <td className="p-3 font-semibold">
                      {formatMoney(row.remaining)}
                    </td>
                    <td className="p-3 text-red-600">
                      {row.overdue ? formatMoney(row.overdue) : "—"}
                    </td>
                    <td className="p-3">{day(row.next_due)}</td>
                  </tr>
                ))}
              {!balances.length && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    Aucun solde ouvert.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
