import { useCallback, useEffect, useState } from "react";
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
import {
  Banknote,
  Plus,
  Receipt,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { AccountingSummary, CashSession, Expense } from "../types";
import Modal from "../components/Modal";
import { useSyncVersion } from "../context/SyncContext";

const EXPENSE_CATEGORIES = [
  "Achat marchandise",
  "Salaires",
  "Loyer",
  "Électricité / Eau",
  "Transport",
  "Divers",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function Comptabilite() {
  const version = useSyncVersion();
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [error, setError] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, e, c] = await Promise.all([
        api.get<AccountingSummary>("/accounting/summary", {
          params: { start, end },
        }),
        api.get<Expense[]>("/accounting/expenses"),
        api.get<CashSession[]>("/cash-sessions", { params: { limit: 10 } }),
      ]);
      setSummary(s.data);
      setExpenses(e.data);
      setSessions(c.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function addExpense() {
    setSaving(true);
    setError("");
    try {
      await api.post("/accounting/expenses", {
        label,
        category,
        amount: Number(amount) || 0,
        date: new Date(date).toISOString(),
      });
      setAddOpen(false);
      setLabel("");
      setAmount("");
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'ajout");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeExpense(expense: Expense) {
    if (!window.confirm(`Supprimer la dépense « ${expense.label} » ?`)) return;
    await api.delete(`/accounting/expenses/${expense.id}`);
    await load();
  }

  const cards = summary
    ? [
        {
          label: "Chiffre d'affaires",
          value: summary.revenue,
          icon: TrendingUp,
          tone: "text-brand-700 bg-brand-50",
        },
        {
          label: "Coût des marchandises",
          value: summary.cost_of_goods,
          icon: Receipt,
          tone: "text-slate-700 bg-slate-100",
        },
        {
          label: "Marge brute",
          value: summary.gross_margin,
          icon: Banknote,
          tone: "text-emerald-700 bg-emerald-50",
        },
        {
          label: "Dépenses",
          value: summary.expenses_total,
          icon: Wallet,
          tone: "text-amber-700 bg-amber-50",
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-4 p-5">
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
        <button className="btn-primary ml-auto" onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Ajouter une dépense
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

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
                <p className="text-xs font-medium text-slate-500">{c.label}</p>
                <p className="text-lg font-extrabold text-slate-900">
                  {formatXOF(c.value)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {summary && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Bénéfice net de la période ({summary.sales_count} ventes)
              </p>
              <p
                className={`text-3xl font-extrabold ${
                  summary.net_profit < 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {formatXOF(summary.net_profit)}
              </p>
            </div>
            <p className="text-sm text-slate-500">
              Marge brute {formatXOF(summary.gross_margin)} − dépenses{" "}
              {formatXOF(summary.expenses_total)}
            </p>
          </div>
        </div>
      )}

      {summary && summary.daily_revenue.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-4 text-base font-bold text-slate-900">
            Ventes par jour
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.daily_revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip
                  formatter={(v) => [formatXOF(Number(v)), "Ventes"]}
                  labelFormatter={(l) => `Jour ${l}`}
                />
                <Bar dataKey="amount" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 text-base font-bold text-slate-900">
            Encaissements par mode de paiement
          </h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {summary?.revenue_by_payment.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-slate-600">{r.name}</td>
                  <td className="py-2 text-right font-semibold text-slate-900">
                    {formatXOF(r.amount)}
                  </td>
                </tr>
              ))}
              {summary?.revenue_by_payment.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-400">
                    Aucune vente sur la période.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-base font-bold text-slate-900">
            Dépenses par catégorie
          </h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {summary?.expenses_by_category.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-slate-600">{r.name}</td>
                  <td className="py-2 text-right font-semibold text-slate-900">
                    {formatXOF(r.amount)}
                  </td>
                </tr>
              ))}
              {summary?.expenses_by_category.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-400">
                    Aucune dépense sur la période.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-base font-bold text-slate-900">
          Dernières dépenses
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Date</th>
              <th className="py-2">Libellé</th>
              <th className="py-2">Catégorie</th>
              <th className="py-2 text-right">Montant</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.map((e) => (
              <tr key={e.id}>
                <td className="py-2 text-slate-500">
                  {new Date(e.date).toLocaleDateString("fr-FR")}
                </td>
                <td className="py-2 font-medium text-slate-800">{e.label}</td>
                <td className="py-2 text-slate-600">{e.category}</td>
                <td className="py-2 text-right font-semibold text-slate-900">
                  {formatXOF(e.amount)}
                </td>
                <td className="py-2 text-right">
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeExpense(e)}
                    aria-label="Supprimer la dépense"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  Aucune dépense enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 text-base font-bold text-slate-900">
          Historique des caisses
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Ouverture</th>
              <th className="py-2">Par</th>
              <th className="py-2 text-right">Fonds</th>
              <th className="py-2 text-right">Attendu</th>
              <th className="py-2 text-right">Compté</th>
              <th className="py-2 text-right">Écart</th>
              <th className="py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="py-2 text-slate-500">
                  {new Date(s.opened_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-2 text-slate-700">
                  {s.opened_by?.name ?? "—"}
                </td>
                <td className="py-2 text-right">
                  {formatXOF(s.opening_balance)}
                </td>
                <td className="py-2 text-right">
                  {s.expected_balance === null
                    ? "—"
                    : formatXOF(s.expected_balance)}
                </td>
                <td className="py-2 text-right">
                  {s.closing_balance === null
                    ? "—"
                    : formatXOF(s.closing_balance)}
                </td>
                <td
                  className={`py-2 text-right font-semibold ${
                    s.difference === null
                      ? "text-slate-400"
                      : Math.abs(s.difference) < 1
                        ? "text-emerald-600"
                        : "text-red-600"
                  }`}
                >
                  {s.difference === null ? "—" : formatXOF(s.difference)}
                </td>
                <td className="py-2">
                  <span
                    className={`badge ${
                      s.closed_at
                        ? "bg-slate-100 text-slate-600"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {s.closed_at ? "Fermée" : "Ouverte"}
                  </span>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Aucune session de caisse.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Nouvelle dépense"
        footer={
          <button className="btn-primary" onClick={addExpense} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Libellé</label>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex. Facture CIE juillet"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Catégorie</label>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Montant (FCFA)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
