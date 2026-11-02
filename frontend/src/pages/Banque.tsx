import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Landmark, Plus, CheckCircle2, XCircle, Ban, Link2 } from "lucide-react";
import api, { formatXOF } from "../api/client";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";

interface BankAccount {
  id: number;
  bank_name: string;
  holder: string;
  account_number: string;
  label: string;
  currency: string;
  is_active: boolean;
  balance: number;
}

interface Deposit {
  id: number;
  account_id: number;
  amount: number;
  deposit_date: string | null;
  method: string;
  reference: string;
  slip_number: string;
  note: string;
  status: string;
  reconciled: boolean;
  statement_ref: string;
  bank_name: string;
  account_label: string;
  created_by_name: string;
}

const STATUS_STYLES: Record<string, string> = {
  "en attente": "bg-amber-100 text-amber-700",
  validé: "bg-emerald-100 text-emerald-700",
  rejeté: "bg-red-100 text-red-700",
  annulé: "bg-slate-200 text-slate-600",
};

function dt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const emptyAccount = {
  bank_name: "",
  holder: "",
  account_number: "",
  label: "",
  currency: "FCFA",
  is_active: true,
  note: "",
};

const emptyDeposit = {
  account_id: 0,
  amount: "",
  method: "Espèces",
  reference: "",
  slip_number: "",
  note: "",
};

/** Versements bancaires: transfert interne caisse → banque, jamais du CA. */
export default function Banque() {
  const { isAdmin } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [accountDraft, setAccountDraft] = useState(emptyAccount);
  const [accountOpen, setAccountOpen] = useState(false);
  const [depositDraft, setDepositDraft] = useState(emptyDeposit);
  const [depositOpen, setDepositOpen] = useState(false);
  const [reconcileId, setReconcileId] = useState<number | null>(null);
  const [statementRef, setStatementRef] = useState("");

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      api.get<BankAccount[]>("/bank/accounts"),
      api.get<Deposit[]>("/bank/deposits", {
        params: status ? { status } : {},
      }),
    ]);
    setAccounts(a.data);
    setDeposits(d.data);
  }, [status]);

  useEffect(() => {
    load().catch(() => setError("Module banque indisponible"));
  }, [load]);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/bank/accounts", accountDraft);
      setAccountOpen(false);
      setAccountDraft(emptyAccount);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        setError(err.response?.data?.detail ?? "Enregistrement impossible");
    }
  }

  async function saveDeposit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/bank/deposits", {
        ...depositDraft,
        amount: Number(depositDraft.amount) || 0,
      });
      setDepositOpen(false);
      setDepositDraft(emptyDeposit);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        setError(err.response?.data?.detail ?? "Enregistrement impossible");
    }
  }

  async function decide(id: number, action: string) {
    setError("");
    const note =
      action === "annuler" || action === "rejeter"
        ? window.prompt("Motif (tracé dans l'historique) :") ?? ""
        : "";
    try {
      await api.post(`/bank/deposits/${id}/decision`, { action, note });
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        setError(err.response?.data?.detail ?? "Action impossible");
    }
  }

  async function reconcile(e: React.FormEvent) {
    e.preventDefault();
    if (reconcileId === null) return;
    try {
      await api.post(`/bank/deposits/${reconcileId}/reconcile`, {
        reconciled: true,
        statement_ref: statementRef,
      });
      setReconcileId(null);
      setStatementRef("");
      await load();
    } catch (err) {
      if (axios.isAxiosError(err))
        setError(err.response?.data?.detail ?? "Rapprochement impossible");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">
          Versements bancaires
        </h1>
        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <button
              className="btn-ghost"
              onClick={() => setAccountOpen(true)}
            >
              <Plus size={16} /> Compte bancaire
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => {
              setDepositDraft({
                ...emptyDeposit,
                account_id: accounts.find((a) => a.is_active)?.id ?? 0,
              });
              setDepositOpen(true);
            }}
            disabled={accounts.length === 0}
          >
            <Plus size={16} /> Nouveau versement
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}
      {accounts.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Enregistrez d'abord un compte bancaire pour saisir des versements.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex items-center gap-2">
              <Landmark size={18} className="text-brand-600" />
              <p className="font-bold text-slate-900">{a.bank_name}</p>
              {!a.is_active && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                  Inactif
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {a.label || a.holder || "—"} · {a.account_number || "—"}
            </p>
            <p className="mt-2 text-lg font-extrabold text-slate-800">
              {formatXOF(a.balance)}
            </p>
            <p className="text-[11px] text-slate-400">
              Solde des versements validés
            </p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-bold text-slate-900">Versements</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Tous les statuts</option>
            <option value="en attente">En attente</option>
            <option value="validé">Validé</option>
            <option value="rejeté">Rejeté</option>
            <option value="annulé">Annulé</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Date</th>
                <th>Banque</th>
                <th>Bordereau</th>
                <th className="text-right">Montant</th>
                <th>Par</th>
                <th>Statut</th>
                <th>Rapproché</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2.5">{dt(d.deposit_date)}</td>
                  <td>
                    {d.bank_name}
                    <span className="block text-xs text-slate-400">
                      {d.account_label}
                    </span>
                  </td>
                  <td className="font-mono text-xs">
                    {d.slip_number || d.reference || "—"}
                  </td>
                  <td className="text-right font-semibold">
                    {formatXOF(d.amount)}
                  </td>
                  <td className="text-slate-600">{d.created_by_name || "—"}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        STATUS_STYLES[d.status] ?? "bg-slate-100"
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td>
                    {d.reconciled ? (
                      <span className="text-xs text-emerald-700">
                        Oui {d.statement_ref && `· ${d.statement_ref}`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {isAdmin && d.status === "en attente" && (
                      <>
                        <button
                          title="Valider"
                          className="mr-1 text-emerald-600"
                          onClick={() => decide(d.id, "valider")}
                        >
                          <CheckCircle2 size={16} />
                        </button>
                        <button
                          title="Rejeter"
                          className="text-red-500"
                          onClick={() => decide(d.id, "rejeter")}
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    )}
                    {isAdmin && d.status === "validé" && (
                      <>
                        {!d.reconciled && (
                          <button
                            title="Rapprocher du relevé"
                            className="mr-1 text-sky-600"
                            onClick={() => setReconcileId(d.id)}
                          >
                            <Link2 size={16} />
                          </button>
                        )}
                        <button
                          title="Annuler"
                          className="text-slate-400"
                          onClick={() => decide(d.id, "annuler")}
                        >
                          <Ban size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">
                    Aucun versement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title="Nouveau compte bancaire"
      >
        <form onSubmit={saveAccount} className="space-y-3">
          <input
            required
            className="input"
            placeholder="Nom de la banque"
            value={accountDraft.bank_name}
            onChange={(e) =>
              setAccountDraft({ ...accountDraft, bank_name: e.target.value })
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input"
              placeholder="Titulaire"
              value={accountDraft.holder}
              onChange={(e) =>
                setAccountDraft({ ...accountDraft, holder: e.target.value })
              }
            />
            <input
              className="input"
              placeholder="N° de compte / IBAN"
              value={accountDraft.account_number}
              onChange={(e) =>
                setAccountDraft({
                  ...accountDraft,
                  account_number: e.target.value,
                })
              }
            />
            <input
              className="input"
              placeholder="Intitulé du compte"
              value={accountDraft.label}
              onChange={(e) =>
                setAccountDraft({ ...accountDraft, label: e.target.value })
              }
            />
            <input
              className="input"
              placeholder="Devise"
              value={accountDraft.currency}
              onChange={(e) =>
                setAccountDraft({ ...accountDraft, currency: e.target.value })
              }
            />
          </div>
          <button className="btn-primary w-full">Enregistrer</button>
        </form>
      </Modal>

      <Modal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title="Nouveau versement bancaire"
      >
        <form onSubmit={saveDeposit} className="space-y-3">
          <p className="text-xs text-slate-500">
            Transfert interne de trésorerie : le montant sort de la caisse et
            entre sur le compte — ce n'est pas un chiffre d'affaires.
          </p>
          <select
            required
            className="input"
            value={depositDraft.account_id}
            onChange={(e) =>
              setDepositDraft({
                ...depositDraft,
                account_id: Number(e.target.value),
              })
            }
          >
            <option value={0}>Compte bancaire destinataire…</option>
            {accounts
              .filter((a) => a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank_name} — {a.label || a.account_number}
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              type="number"
              min="1"
              className="input"
              placeholder="Montant (FCFA)"
              value={depositDraft.amount}
              onChange={(e) =>
                setDepositDraft({ ...depositDraft, amount: e.target.value })
              }
            />
            <input
              className="input"
              placeholder="N° de bordereau"
              value={depositDraft.slip_number}
              onChange={(e) =>
                setDepositDraft({
                  ...depositDraft,
                  slip_number: e.target.value,
                })
              }
            />
            <input
              className="input"
              placeholder="Référence de transaction"
              value={depositDraft.reference}
              onChange={(e) =>
                setDepositDraft({ ...depositDraft, reference: e.target.value })
              }
            />
            <input
              className="input"
              placeholder="Mode de versement"
              value={depositDraft.method}
              onChange={(e) =>
                setDepositDraft({ ...depositDraft, method: e.target.value })
              }
            />
          </div>
          <input
            className="input"
            placeholder="Observation"
            value={depositDraft.note}
            onChange={(e) =>
              setDepositDraft({ ...depositDraft, note: e.target.value })
            }
          />
          <button className="btn-primary w-full">Enregistrer</button>
        </form>
      </Modal>

      <Modal
        open={reconcileId !== null}
        onClose={() => setReconcileId(null)}
        title="Rapprochement bancaire"
      >
        <form onSubmit={reconcile} className="space-y-3">
          <p className="text-xs text-slate-500">
            Confirmez que ce versement figure sur le relevé bancaire.
          </p>
          <input
            className="input"
            placeholder="Référence du relevé (facultatif)"
            value={statementRef}
            onChange={(e) => setStatementRef(e.target.value)}
          />
          <button className="btn-primary w-full">Marquer rapproché</button>
        </form>
      </Modal>
    </div>
  );
}
