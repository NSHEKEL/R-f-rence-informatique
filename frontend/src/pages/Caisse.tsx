import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { CheckCircle2, Lock, Printer, ShoppingCart, Unlock, Wallet } from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { CashMovement, CashSession, CashSessionDetail, ReceiptFormat } from "../types";
import CashTicket, { type CashTicketKind } from "../components/CashTicket";
import ZReport, { type ZReportData } from "../components/ZReport";
import Modal from "../components/Modal";
import PrinterHint from "../components/PrinterHint";
import { enterFullscreen, leaveFullscreen } from "../lib/fullscreen";
import { printReceipt } from "../lib/print";
import { useAuth } from "../context/AuthContext";
import { useTill } from "../context/TillContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

/**
 * Till screen: one opening and one closing per cashier and per day. Selling
 * happens on the dedicated POS screen.
 */
export default function Caisse() {
  const { user, isAdmin, can } = useAuth();
  const canBalances = can("soldes_consulter");
  const canClosures = can("clotures_consulter");
  const canZ = canBalances && (canClosures || can("caisse_z"));
  const canEntry = can("caisse_operations") || can("recette_enregistrer");
  const canExit = can("caisse_operations");
  const { refresh: refreshTill } = useTill();
  const { company, printing } = useCompany();
  const version = useSyncVersion();

  const [today, setToday] = useState<CashSessionDetail | null>(null);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [movementType, setMovementType] = useState<"in" | "out">("in");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");

  const [closeOpen, setCloseOpen] = useState(false);
  const [countedBalance, setCountedBalance] = useState("0");
  const [closeNote, setCloseNote] = useState("");

  const [ticket, setTicket] = useState<{
    session: CashSessionDetail;
    kind: CashTicketKind;
  } | null>(null);
  const [zReport, setZReport] = useState<ZReportData | null>(null);
  const format: ReceiptFormat = printing.receipt.width;

  const load = useCallback(async () => {
    const [session, sessions] = await Promise.all([
      api.get<CashSessionDetail | null>("/cash-sessions/today"),
      canClosures ? api.get<CashSession[]>("/cash-sessions", { params: { limit: 15 } }) : Promise.resolve({ data: [] }),
    ]);
    setToday(session.data);
    setHistory(sessions.data);
    setMovements(session.data ? (await api.get<CashMovement[]>(`/cash-sessions/${session.data.id}/movements`)).data : []);
  }, [canClosures]);

  useEffect(() => {
    load().catch(() => setError("Impossible de charger la caisse"));
  }, [load, version]);

  const showTicket = useCallback(
    (session: CashSessionDetail, kind: CashTicketKind, auto: boolean) => {
      if (!canBalances || (kind === "close" && !canZ)) return;
      setTicket({ session, kind });
      if (auto && company?.auto_print_cash !== false) {
        // Let the print copy mount before asking the browser to print.
        window.setTimeout(() => printReceipt(format, printing.receipt), 400);
      }
    },
    [company?.auto_print_cash, format, printing.receipt, canBalances, canZ]
  );

  async function addMovement() {
    setSaving(true);
    setError("");
    try {
      await api.post("/cash-sessions/movements", {
        type: movementType, amount: Number(movementAmount), reason: movementReason,
      });
      setMovementAmount("");
      setMovementReason("");
      await load();
      await refreshTill();
    } catch (err) {
      if (axios.isAxiosError(err)) setError(err.response?.data?.detail ?? "Opération impossible");
    } finally {
      setSaving(false);
    }
  }

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
      await refreshTill();
      // The counter works better without the desktop around it; the header
      // button leaves full screen again.
      if (!isAdmin) await enterFullscreen();
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
      await refreshTill();
      await leaveFullscreen();
      showTicket(res.data, "close", true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible de fermer la caisse");
      }
    } finally {
      setSaving(false);
    }
  }

  async function showZ(sessionId: number) {
    setError("");
    try {
      const res = await api.get<ZReportData>(`/cash-sessions/${sessionId}/z`);
      setZReport(res.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "État Z indisponible");
      }
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
          Ouvrez votre caisse avant de vendre, puis clôturez-la en fin de journée.
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
              {canBalances && <button
                className="btn-ghost"
                onClick={() => showTicket(today, "open", false)}
              >
                <Printer size={16} /> Ticket d'ouverture
              </button>}
              {canZ && <button className="btn-ghost" onClick={() => showZ(today.id)}>
                <Printer size={16} /> État Z
              </button>}
              {closed && canZ && (
                <button
                  className="btn-ghost"
                  onClick={() => showTicket(today, "close", false)}
                >
                  <Printer size={16} /> Ticket de fermeture
                </button>
              )}
              {!closed && (
                <>
                  {can("caisse_fermer") && (
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setCountedBalance(today.expected_cash == null ? "" : String(today.expected_cash));
                        setCloseNote("");
                        setCloseOpen(true);
                      }}
                    >
                      <Lock size={16} /> Fermer ma caisse
                    </button>
                  )}
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
              ["Recettes de caisse", formatXOF(today.entries_total)],
              ["Sorties de caisse", formatXOF(today.exits_total)],
              ["Règlements espèces nets", formatXOF(today.cash_settlements)],
              ["Remboursements espèces", formatXOF(today.cash_refunds)],
              [
                closed ? "Solde compté" : "Solde attendu",
                formatXOF(
                  closed ? today.closing_balance : today.expected_cash
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

          {canBalances && <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-slate-900">
              Ventes de la session
            </h3>
            {(today.sales ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">
                Aucune vente enregistrée dans cette session.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="py-2 pl-3">Réf.</th>
                      <th>Heure</th>
                      <th>Paiement</th>
                      <th className="text-right">Total</th>
                      <th className="pr-3 text-right">Encaissé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(today.sales ?? []).map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="py-2 pl-3 font-medium text-slate-700">
                          {s.reference}
                        </td>
                        <td className="text-slate-500">
                          {s.date
                            ? new Date(s.date).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="text-slate-500">{s.payment_method}</td>
                        <td className="text-right font-semibold text-slate-800">
                          {formatXOF(s.total)}
                        </td>
                        <td className="pr-3 text-right text-emerald-700">
                          {formatXOF(s.paid_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>}

          {!canBalances && <p className="mt-4 text-sm text-slate-500">Les soldes ne sont pas accessibles avec vos droits.</p>}
          {closed && today.difference != null && (
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

      {today && <div className="card space-y-4 p-5">
        <h2 className="text-sm font-bold text-slate-900">Recettes et sorties de caisse</h2>
        {!closed && canEntry && <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void addMovement(); }}>
          <div><label className="label">Opération</label><select className="input" value={movementType} onChange={(e) => setMovementType(e.target.value as "in" | "out")}>
            <option value="in">Recette</option>
            {canExit && <option value="out">Sortie</option>}
          </select></div>
          <div><label className="label">Montant</label><input className="input" type="number" min="0.01" step="0.01" required value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} /></div>
          <div><label className="label">Motif obligatoire</label><input className="input" maxLength={1000} required value={movementReason} onChange={(e) => setMovementReason(e.target.value)} /></div>
          <button className="btn-primary self-end" disabled={saving || !movementReason.trim()}>Enregistrer</button>
        </form>}
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="py-2">Date</th><th>Opération</th><th>Motif</th><th>Poste</th><th className="text-right">Montant</th></tr></thead>
          <tbody>{movements.map((m) => <tr key={m.id} className="border-b border-slate-100">
            <td className="py-2">{new Date(m.created_at).toLocaleString("fr-FR")}</td><td>{m.type === "in" ? "Recette" : "Sortie"}</td><td>{m.reason}</td><td>{m.workstation || "—"}</td><td className="text-right">{formatXOF(m.amount)}</td>
          </tr>)}</tbody>
        </table>{movements.length === 0 && <p className="py-3 text-sm text-slate-500">Aucun mouvement de caisse.</p>}</div>
      </div>}

      {canClosures && <div className="card p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-900">
          Dernières caisses
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
                    {canZ && <button
                      className="ml-2 text-xs font-semibold text-brand-600 underline"
                      onClick={() => showZ(s.id)}
                    >
                      État Z
                    </button>}
                    {isAdmin && s.closed_at && (
                      <button
                        className="ml-2 text-xs font-semibold text-amber-600 underline"
                        onClick={async () => {
                          try {
                            await api.post(`/cash-sessions/${s.id}/reopen`);
                            await load();
                            await refreshTill();
                          } catch (err) {
                            if (axios.isAxiosError(err)) {
                              setError(
                                err.response?.data?.detail ??
                                  "Réouverture impossible"
                              );
                            }
                          }
                        }}
                      >
                        Rouvrir
                      </button>
                    )}
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
      </div>}

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
              ["Fonds d'ouverture", formatXOF(today?.opening_balance)],
              ["Ventes espèces", formatXOF(today?.cash_sales)],
              ["Solde attendu", formatXOF(today?.expected_cash)],
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
            <label className="label">
              Note {!canBalances ? "(obligatoire)" : Math.abs(countedDifference) >= 1 ? "(obligatoire : justification de l'écart)" : "(facultatif)"}
            </label>
            <input
              className="input"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="Ex. fonds remis par le gérant"
            />
          </div>
          {canBalances && <p
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              Math.abs(countedDifference) < 1
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {Math.abs(countedDifference) < 1
              ? "Caisse conforme"
              : `Écart : ${formatXOF(countedDifference)}`}
          </p>}
        </div>
      </Modal>

      <Modal
        open={zReport !== null}
        onClose={() => setZReport(null)}
        title={`État Z de caisse — session #${zReport?.session_id ?? ""}`}
        footer={
          <div className="no-print flex w-full justify-end gap-3">
            <button className="btn-ghost" onClick={() => setZReport(null)}>
              Fermer
            </button>
            <PrinterHint />
            <button
              className="btn-primary"
              onClick={() => printReceipt(format, printing.receipt)}
            >
              <Printer size={16} /> Imprimer
            </button>
          </div>
        }
      >
        {zReport && (
          <ZReport report={zReport} company={company} format={format} />
        )}
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
              onClick={() => printReceipt(format, printing.receipt)}
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
