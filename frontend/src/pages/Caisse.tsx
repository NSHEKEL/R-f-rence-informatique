import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { CheckCircle2, Lock, Printer, ShoppingCart, Unlock, Wallet } from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { CashSession, CashSessionDetail, ReceiptFormat } from "../types";
import CashTicket, { type CashTicketKind } from "../components/CashTicket";
import Modal from "../components/Modal";
import PrinterHint from "../components/PrinterHint";
import { printReceipt } from "../lib/print";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

/**
 * Till screen: one opening and one closing per cashier and per day. Selling
 * happens on the dedicated POS screen.
 */
export default function Caisse() {
  const { user, isAdmin } = useAuth();
  const { company } = useCompany();
  const version = useSyncVersion();

  const [today, setToday] = useState<CashSessionDetail | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [closeOpen, setCloseOpen] = useState(false);
  const [countedBalance, setCountedBalance] = useState("0");
  const [closeNote, setCloseNote] = useState("");

  const [ticket, setTicket] = useState<{
    session: CashSessionDetail;
    kind: CashTicketKind;
  } | null>(null);
  const format: ReceiptFormat = company?.receipt_format === "80mm" ? "80mm" : "A4";

  const load = useCallback(async () => {
    const [session, sessions] = await Promise.all([
      api.get<CashSessionDetail | null>("/cash-sessions/today"),
      api.get<CashSession[]>("/cash-sessions", { params: { limit: 15 } }),
    ]);
    setToday(session.data);
    setHistory(sessions.data);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Impossible de charger la caisse"));
  }, [load, version]);

  const showTicket = useCallback(
    (session: CashSessionDetail, kind: CashTicketKind, auto: boolean) => {
      setTicket({ session, kind });
      if (auto && company?.auto_print_cash !== false) {
        // Let the print copy mount before asking the browser to print.
        window.setTimeout(() => printReceipt(format), 400);
      }
    },
    [company?.auto_print_cash, format]
  );

  async function openTill() {
    setSaving(true);
    setError("");
    try {
      const res = await api.post<CashSessionDetail>("/cash-sessions/open", {
        opening_balance: Number(openingBalance) || 0,
        note,
      });
      setNote("");
      setOpeningBalance("0");
      await load();
      showTicket(res.data, "open", true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible d'ouvrir la caisse");
      }
    } finally {
      setSaving(false);
    }
  }

  async function closeTill() {
    setSaving(true);
    setError("");
    try {
      const res = await api.post<CashSessionDetail>("/cash-sessions/close", {
        closing_balance: Number(countedBalance) || 0,
        note: closeNote,
      });
      setCloseOpen(false);
      setCloseNote("");
      await load();
      showTicket(res.data, "close", true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible de fermer la caisse");
      }
    } finally {
      setSaving(false);
    }
  }

  const closed = Boolean(today?.closed_at);
  const countedDifference =
    (Number(countedBalance) || 0) - (today?.expected_cash ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Ma caisse</h1>
        <p className="text-sm text-slate-500">
          Une ouverture par caissier et par jour. Le ticket d'ouverture
          s'imprime automatiquement.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      {!today && (
        <div className="card space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Wallet size={20} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">
                Caisse non ouverte aujourd'hui
              </p>
              <p className="text-xs text-slate-500">
                Saisissez le fonds de caisse pour commencer la journée.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Fonds de caisse initial (FCFA)</label>
              <input
                autoFocus
                className="input"
                type="number"
                min="0"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Note (facultatif)</label>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex. billets remis par le gérant"
              />
            </div>
          </div>
          <button
            className="btn-primary w-full py-3 text-base sm:w-auto"
            onClick={openTill}
            disabled={saving}
          >
            <Unlock size={16} />
            {saving ? "Ouverture..." : "Ouvrir ma caisse"}
          </button>
        </div>
      )}

      {today && (
        <div className="card space-y-5 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                closed
                  ? "bg-slate-100 text-slate-500"
                  : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {closed ? <Lock size={20} /> : <CheckCircle2 size={20} />}
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {closed ? "Caisse fermée pour aujourd'hui" : "Caisse ouverte"}
              </p>
              <p className="text-xs text-slate-500">
                {today.opened_by?.name ?? user?.name} · journée{" "}
                {today.business_day}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                className="btn-ghost"
                onClick={() => showTicket(today, "open", false)}
              >
                <Printer size={16} /> Ticket d'ouverture
              </button>
              {closed && (
                <button
                  className="btn-ghost"
                  onClick={() => showTicket(today, "close", false)}
                >
                  <Printer size={16} /> Ticket de fermeture
                </button>
              )}
              {!closed && (
                <>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setCountedBalance(String(today.expected_cash));
                      setCloseNote("");
                      setCloseOpen(true);
                    }}
                  >
                    <Lock size={16} /> Fermer ma caisse
                  </button>
                  <Link className="btn-primary" to="/ventes/nouvelle">
                    <ShoppingCart size={16} /> Aller à la vente
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Fonds d'ouverture", formatXOF(today.opening_balance)],
              ["Ventes espèces", formatXOF(today.cash_sales)],
              ["Autres paiements", formatXOF(today.other_sales)],
              [
                closed ? "Solde compté" : "Solde attendu",
                formatXOF(
                  closed ? today.closing_balance ?? 0 : today.expected_cash
                ),
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-base font-extrabold text-slate-800">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {closed && (
            <p
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                Math.abs(today.difference ?? 0) < 1
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {Math.abs(today.difference ?? 0) < 1
                ? "Caisse conforme"
                : `Écart : ${formatXOF(today.difference ?? 0)}`}
            </p>
          )}

          {!closed && (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
              La fermeture se fait une seule fois par jour, en fin de journée.
            </p>
          )}
        </div>
      )}

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-900">
          {isAdmin ? "Dernières caisses" : "Mes dernières caisses"}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-2">Journée</th>
                <th>Caissier</th>
                <th className="text-right">Fonds</th>
                <th className="text-right">Solde compté</th>
                <th className="text-right">Écart</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-2.5 font-medium text-slate-700">
                    {s.business_day ||
                      new Date(s.opened_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="text-slate-600">{s.opened_by?.name ?? "—"}</td>
                  <td className="text-right">{formatXOF(s.opening_balance)}</td>
                  <td className="text-right">
                    {s.closing_balance === null
                      ? "—"
                      : formatXOF(s.closing_balance)}
                  </td>
                  <td className="text-right">
                    {s.difference === null ? "—" : formatXOF(s.difference)}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
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
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Aucune caisse enregistrée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Fermeture de caisse"
        footer={
          <div className="flex w-full justify-end gap-3">
            <button className="btn-ghost" onClick={() => setCloseOpen(false)}>
              Annuler
            </button>
            <button
              className="btn-primary"
              onClick={closeTill}
              disabled={saving}
            >
              <Lock size={16} /> Fermer ma caisse
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Fonds d'ouverture", formatXOF(today?.opening_balance ?? 0)],
              ["Ventes espèces", formatXOF(today?.cash_sales ?? 0)],
              ["Solde attendu", formatXOF(today?.expected_cash ?? 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm font-bold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <div>
            <label className="label">Montant compté en caisse (FCFA)</label>
            <input
              autoFocus
              className="input"
              type="number"
              min="0"
              value={countedBalance}
              onChange={(e) => setCountedBalance(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Note (facultatif)</label>
            <input
              className="input"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="Ex. fonds remis par le gérant"
            />
          </div>
          <p
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              Math.abs(countedDifference) < 1
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {Math.abs(countedDifference) < 1
              ? "Caisse conforme"
              : `Écart : ${formatXOF(countedDifference)}`}
          </p>
        </div>
      </Modal>

      <Modal
        open={ticket !== null}
        onClose={() => setTicket(null)}
        title={
          ticket?.kind === "close"
            ? "Ticket de fermeture de caisse"
            : "Ticket d'ouverture de caisse"
        }
        footer={
          <div className="no-print flex w-full justify-end gap-3">
            <button className="btn-ghost" onClick={() => setTicket(null)}>
              Fermer
            </button>
            <PrinterHint />
            <button
              className="btn-primary"
              onClick={() => printReceipt(format)}
            >
              <Printer size={16} /> Imprimer
            </button>
          </div>
        }
      >
        {ticket && (
          <CashTicket
            session={ticket.session}
            company={company}
            format={format}
            kind={ticket.kind}
          />
        )}
      </Modal>
    </div>
  );
}
