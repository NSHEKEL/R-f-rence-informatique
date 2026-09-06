import { Fragment, useCallback, useEffect, useState } from "react";
import axios from "axios";
import { HandCoins, Plus, Trash2, Wallet } from "lucide-react";
import api, { formatMoney } from "../api/client";
import { useAuth } from "../context/AuthContext";

/**
 * Debts and receivables: what the customers still owe, what the shop owes.
 *
 * A sale paid later opens its receivable by itself; everything else is
 * written down here. Settlements are kept one by one and never overwrite the
 * original amount.
 */

interface Payment {
  id: number;
  amount: number;
  date: string;
  method: string;
  note: string;
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
  payments: Payment[];
}

interface Summary {
  receivable_total: number;
  receivable_overdue: number;
  receivable_count: number;
  payable_total: number;
  payable_overdue: number;
  payable_count: number;
}

const METHODS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"];
const EMPTY = {
  kind: "creance",
  party: "",
  reference: "",
  amount: "",
  due_date: "",
  note: "",
};

function day(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

export default function Dettes() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Debt[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kind, setKind] = useState("creance");
  const [status, setStatus] = useState("ouvertes");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState(0);
  const [payment, setPayment] = useState({ amount: "", method: METHODS[0] });
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([
        api.get<Debt[]>("/debts", { params: { kind, status, search } }),
        api.get<Summary>("/debts/resume"),
      ]);
      setRows(list.data);
      setSummary(totals.data);
    } catch {
      setMessage("Chargement impossible.");
    }
  }, [kind, status, search]);

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
        kind: form.kind,
        party: form.party,
        reference: form.reference,
        amount: Number(form.amount),
        due_date: form.due_date ? `${form.due_date}T00:00:00` : null,
        note: form.note,
      });
      setForm({ ...EMPTY, kind: form.kind });
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
      await api.post(`/debts/${debt.id}/paiements`, {
        amount: Number(payment.amount),
        method: payment.method,
      });
      setPayment({ amount: "", method: METHODS[0] });
      setMessage("");
      await load();
    } catch (error) {
      fail(error, "Règlement impossible.");
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

  const receivable = kind === "creance";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card flex items-center gap-3 p-4">
          <HandCoins className="text-brand-600" />
          <div>
            <p className="text-sm text-slate-500">Créances (clients à encaisser)</p>
            <p className="text-xl font-bold">
              {formatMoney(summary?.receivable_total ?? 0)}
            </p>
            <p className="text-xs text-slate-400">
              {summary?.receivable_count ?? 0} écriture(s) — en retard :{" "}
              {formatMoney(summary?.receivable_overdue ?? 0)}
            </p>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <Wallet className="text-amber-600" />
          <div>
            <p className="text-sm text-slate-500">Dettes (à payer aux fournisseurs)</p>
            <p className="text-xl font-bold">
              {formatMoney(summary?.payable_total ?? 0)}
            </p>
            <p className="text-xs text-slate-400">
              {summary?.payable_count ?? 0} écriture(s) — en retard :{" "}
              {formatMoney(summary?.payable_overdue ?? 0)}
            </p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-1">
            {[
              ["creance", "Créances clients"],
              ["dette", "Dettes fournisseurs"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setKind(value)}
                className={`rounded-md px-3 py-1 text-sm ${
                  kind === value ? "bg-white font-semibold shadow" : "text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-5"
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
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
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
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
            <button className="btn-primary">Enregistrer</button>
          </form>
        )}

        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">{receivable ? "Client" : "Fournisseur"}</th>
              <th className="p-3">Référence</th>
              <th className="p-3">Montant</th>
              <th className="p-3">Réglé</th>
              <th className="p-3">Reste</th>
              <th className="p-3">Échéance</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((debt) => (
              <Fragment key={debt.id}>
                <tr
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => setOpened(opened === debt.id ? 0 : debt.id)}
                >
                  <td className="p-3 font-medium">{debt.party || "—"}</td>
                  <td className="p-3">{debt.reference || "—"}</td>
                  <td className="p-3">{formatMoney(debt.amount)}</td>
                  <td className="p-3 text-emerald-700">{formatMoney(debt.paid)}</td>
                  <td
                    className={`p-3 font-semibold ${
                      debt.settled
                        ? "text-slate-400"
                        : debt.overdue
                          ? "text-red-600"
                          : "text-slate-900"
                    }`}
                  >
                    {debt.settled ? "Soldée" : formatMoney(debt.remaining)}
                  </td>
                  <td className="p-3">{day(debt.due_date)}</td>
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
                  <tr className="bg-slate-50">
                    <td colSpan={7} className="p-3">
                      <div className="space-y-2">
                        {debt.payments.length ? (
                          <ul className="space-y-1 text-xs text-slate-600">
                            {debt.payments.map((row) => (
                              <li key={row.id}>
                                {day(row.date)} — {formatMoney(row.amount)} (
                                {row.method})
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
                              placeholder="Montant réglé"
                              value={payment.amount}
                              onChange={(e) =>
                                setPayment({ ...payment, amount: e.target.value })
                              }
                              required
                            />
                            <select
                              className="input w-44"
                              value={payment.method}
                              onChange={(e) =>
                                setPayment({ ...payment, method: e.target.value })
                              }
                            >
                              {METHODS.map((method) => (
                                <option key={method}>{method}</option>
                              ))}
                            </select>
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
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  Aucune écriture.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
