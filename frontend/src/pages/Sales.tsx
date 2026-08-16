import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Eye,
  Lock,
  Pencil,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  Search,
  Trash2,
} from "lucide-react";
import api, { formatDateTime, formatXOF } from "../api/client";
import type {
  CashSessionDetail,
  Customer,
  ReceiptFormat,
  Sale,
} from "../types";
import CashTicket from "../components/CashTicket";
import Modal from "../components/Modal";
import Receipt from "../components/Receipt";
import { printReceipt } from "../lib/print";
import { statusBadge } from "../components/badges";
import PrinterHint from "../components/PrinterHint";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

const PAYMENTS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"];

export default function Sales() {
  const { isAdmin } = useAuth();
  const { company } = useCompany();
  const version = useSyncVersion();
  const navigate = useNavigate();

  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [session, setSession] = useState<CashSessionDetail | null>(null);
  const [daySession, setDaySession] = useState<CashSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Sale | null>(null);
  const [error, setError] = useState("");

  // Receipt modal
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState(false);
  const [rCustomerId, setRCustomerId] = useState<string>("");
  const [rPayment, setRPayment] = useState(PAYMENTS[0]);
  const [rNote, setRNote] = useState("");
  const [rFooter, setRFooter] = useState("");
  const [rSaving, setRSaving] = useState(false);
  const [rFormat, setRFormat] = useState<ReceiptFormat>("A4");

  // Till closing (once a day, from the sales side)
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedBalance, setCountedBalance] = useState("0");
  const [closeNote, setCloseNote] = useState("");
  const [closedTicket, setClosedTicket] = useState<CashSessionDetail | null>(
    null
  );

  const format: ReceiptFormat =
    company?.receipt_format === "80mm" ? "80mm" : "A4";

  const load = useCallback(async () => {
    const [s, c, current, today] = await Promise.all([
      api.get<Sale[]>("/sales"),
      api.get<Customer[]>("/customers"),
      api.get<CashSessionDetail | null>("/cash-sessions/current"),
      api.get<CashSessionDetail | null>("/cash-sessions/today"),
    ]);
    setSales(s.data);
    setCustomers(c.data);
    setSession(current.data);
    setDaySession(today.data);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Impossible de charger les ventes"));
  }, [load, version]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return sales.filter(
      (s) =>
        s.reference.toLowerCase().includes(q) ||
        (s.customer?.name ?? "").toLowerCase().includes(q)
    );
  }, [sales, query]);

  async function remove(s: Sale) {
    if (!confirm(`Supprimer la vente ${s.reference} ? Le stock sera réajusté.`))
      return;
    await api.delete(`/sales/${s.id}`);
    await load();
  }

  function openReceipt(s: Sale, asDuplicate: boolean) {
    setReceiptSale(s);
    setDuplicate(asDuplicate);
    setEditingReceipt(false);
    setError("");
    setRFormat(format);
    setRCustomerId(s.customer_id ? String(s.customer_id) : "");
    setRPayment(s.payment_method);
    setRNote(s.note ?? "");
    setRFooter(s.receipt_footer ?? "");
  }

  /** Prints and records the copy so the history shows how many were issued. */
  async function printAndCount() {
    if (!receiptSale) return;
    printReceipt(rFormat);
    try {
      const res = await api.post<Sale>(`/sales/${receiptSale.id}/print`);
      setReceiptSale(res.data);
      setSales((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)));
    } catch {
      /* printing must not fail because the counter could not be saved */
    }
  }

  async function saveReceipt() {
    if (!receiptSale) return;
    setRSaving(true);
    setError("");
    try {
      const res = await api.put<Sale>(`/sales/${receiptSale.id}`, {
        customer_id: rCustomerId === "" ? null : Number(rCustomerId),
        payment_method: rPayment,
        note: rNote,
        receipt_footer: rFooter,
      });
      setReceiptSale(res.data);
      setSales((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)));
      setEditingReceipt(false);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.detail ?? "Erreur lors de l'enregistrement"
        );
      }
    } finally {
      setRSaving(false);
    }
  }

  async function closeTill() {
    setError("");
    try {
      const res = await api.post<CashSessionDetail>("/cash-sessions/close", {
        closing_balance: Number(countedBalance) || 0,
        note: closeNote,
      });
      setCloseOpen(false);
      setCloseNote("");
      await load();
      setClosedTicket(res.data);
      if (company?.auto_print_cash !== false) {
        window.setTimeout(() => printReceipt(format), 400);
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Impossible de fermer la caisse");
      }
    }
  }

  const countedDifference =
    (Number(countedBalance) || 0) - (session?.expected_cash ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-3 text-slate-400"
          />
          <input
            className="input pl-11"
            placeholder="Rechercher une vente..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          {session ? (
            <button
              className="btn-ghost"
              onClick={() => {
                setCountedBalance(String(session.expected_cash));
                setCloseNote("");
                setCloseOpen(true);
              }}
            >
              <Lock size={18} /> Fermer ma caisse
            </button>
          ) : (
            daySession?.closed_at && (
              <span className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                <Lock size={14} /> Caisse déjà fermée aujourd'hui
              </span>
            )
          )}
          <button
            className="btn-primary"
            onClick={() => navigate("/ventes/nouvelle")}
          >
            <Plus size={18} /> Nouvelle vente
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Référence</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Paiement</th>
                <th className="px-5 py-3 text-center">Statut</th>
                <th className="px-5 py-3 text-center">Reçu</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 font-semibold text-slate-800">
                    {s.reference}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {s.customer?.name ?? "Client de passage"}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {formatDateTime(s.date)}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {s.payment_method}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    {statusBadge(s.status)}
                  </td>
                  <td className="px-5 py-3.5 text-center text-xs">
                    {s.print_count > 0 ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                        Imprimé ×{s.print_count}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-800">
                    {formatXOF(s.total)}
                    {s.returned_total > 0 && (
                      <span className="block text-xs font-medium text-amber-600">
                        Avoir : {formatXOF(s.returned_total)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setDetail(s)}
                        aria-label="Détails de la vente"
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => openReceipt(s, s.print_count > 0)}
                        title={
                          s.print_count > 0
                            ? "Réimprimer (duplicata)"
                            : "Reçu de caisse"
                        }
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <ReceiptIcon size={16} />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => remove(s)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-slate-400"
                  >
                    Aucune vente trouvée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Vente ${detail.reference}` : ""}
        wide
        footer={
          detail && (
            <button
              className="btn-primary"
              onClick={() => {
                const s = detail;
                setDetail(null);
                openReceipt(s, s.print_count > 0);
              }}
            >
              <ReceiptIcon size={16} /> Voir le reçu
            </button>
          )
        }
      >
        {detail && (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-slate-400">Client</p>
                <p className="font-semibold text-slate-800">
                  {detail.customer?.name ?? "Passage"}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Créée par</p>
                <p className="font-semibold text-slate-800">
                  {detail.created_by?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Date</p>
                <p className="font-semibold text-slate-800">
                  {formatDateTime(detail.date)}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Paiement</p>
                <p className="font-semibold text-slate-800">
                  {detail.payment_method}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Statut</p>
                {statusBadge(detail.status)}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="py-2">Article</th>
                  <th className="py-2 text-center">Qté</th>
                  <th className="py-2 text-right">P.U.</th>
                  <th className="py-2 text-right">Sous-total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2.5 text-slate-800">
                      {it.product_name}
                      {it.returned_quantity > 0 && (
                        <span className="ml-2 text-xs text-amber-600">
                          {it.returned_quantity} retourné(s)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-center text-slate-600">
                      {it.quantity}
                    </td>
                    <td className="py-2.5 text-right text-slate-600">
                      {formatXOF(it.unit_price)}
                    </td>
                    <td className="py-2.5 text-right font-medium text-slate-800">
                      {formatXOF(it.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-sm font-medium text-slate-500">Total</span>
              <span className="text-xl font-extrabold text-slate-900">
                {formatXOF(detail.total)}
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* Receipt modal */}
      <Modal
        open={receiptSale !== null}
        onClose={() => setReceiptSale(null)}
        title={
          receiptSale
            ? `${duplicate ? "Duplicata" : "Reçu"} — ${receiptSale.reference}`
            : ""
        }
        footer={
          receiptSale && (
            <div className="no-print flex w-full flex-wrap items-center justify-between gap-3">
              <button
                className="btn-ghost"
                onClick={() => setEditingReceipt((v) => !v)}
              >
                <Pencil size={16} /> {editingReceipt ? "Fermer" : "Modifier"}
              </button>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <input
                    type="checkbox"
                    checked={duplicate}
                    onChange={(e) => setDuplicate(e.target.checked)}
                  />
                  Duplicata
                </label>
                <select
                  className="input w-auto"
                  value={rFormat}
                  onChange={(e) =>
                    setRFormat(e.target.value === "80mm" ? "80mm" : "A4")
                  }
                  title="Format d'impression"
                >
                  <option value="A4">Feuille A4</option>
                  <option value="80mm">Ticket 80 mm</option>
                </select>
                {editingReceipt && (
                  <button
                    className="btn-primary"
                    onClick={saveReceipt}
                    disabled={rSaving}
                  >
                    {rSaving ? "Enregistrement..." : "Enregistrer"}
                  </button>
                )}
                <PrinterHint />
                <button className="btn-primary" onClick={printAndCount}>
                  <Printer size={16} /> Imprimer
                </button>
              </div>
            </div>
          )
        }
      >
        {receiptSale && (
          <div>
            {error && (
              <div className="no-print mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                {error}
              </div>
            )}

            {editingReceipt && (
              <div className="no-print mb-5 space-y-4 rounded-xl bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Client</label>
                    <select
                      className="input"
                      value={rCustomerId}
                      onChange={(e) => setRCustomerId(e.target.value)}
                    >
                      <option value="">Client de passage</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Paiement</label>
                    <select
                      className="input"
                      value={rPayment}
                      onChange={(e) => setRPayment(e.target.value)}
                    >
                      {PAYMENTS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Note</label>
                  <textarea
                    className="input min-h-[60px]"
                    value={rNote}
                    onChange={(e) => setRNote(e.target.value)}
                    placeholder="Note affichée sur le reçu"
                  />
                </div>
                <div>
                  <label className="label">Message de pied de reçu</label>
                  <textarea
                    className="input min-h-[50px]"
                    value={rFooter}
                    onChange={(e) => setRFooter(e.target.value)}
                    placeholder={
                      company?.receipt_footer || "Merci de votre confiance !"
                    }
                  />
                </div>
              </div>
            )}

            <Receipt
              sale={
                editingReceipt
                  ? {
                      ...receiptSale,
                      customer:
                        rCustomerId === ""
                          ? null
                          : customers.find(
                              (c) => c.id === Number(rCustomerId)
                            ) ?? receiptSale.customer,
                      payment_method: rPayment,
                      note: rNote,
                      receipt_footer: rFooter,
                    }
                  : receiptSale
              }
              company={company}
              format={rFormat}
              duplicate={duplicate}
            />
          </div>
        )}
      </Modal>

      {/* Till closing */}
      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Fermeture de caisse"
        footer={
          <button className="btn-primary" onClick={closeTill}>
            Fermer ma caisse
          </button>
        }
      >
        {session && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
              <span className="text-slate-500">Fonds d'ouverture</span>
              <span className="text-right font-semibold">
                {formatXOF(session.opening_balance)}
              </span>
              <span className="text-slate-500">Ventes en espèces</span>
              <span className="text-right font-semibold">
                {formatXOF(session.cash_sales)}
              </span>
              <span className="text-slate-500">Solde attendu</span>
              <span className="text-right font-extrabold text-brand-700">
                {formatXOF(session.expected_cash)}
              </span>
            </div>
            <div>
              <label className="label">Montant compté en caisse (FCFA)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={countedBalance}
                onChange={(e) => setCountedBalance(e.target.value)}
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
            <div>
              <label className="label">Note de fermeture (facultatif)</label>
              <input
                className="input"
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-400">
              La fermeture n'est possible qu'une fois par jour ; le ticket
              s'imprime automatiquement.
            </p>
          </div>
        )}
      </Modal>

      {/* Closing ticket */}
      <Modal
        open={closedTicket !== null}
        onClose={() => setClosedTicket(null)}
        title="Ticket de fermeture de caisse"
        footer={
          <div className="no-print flex w-full justify-end gap-3">
            <button className="btn-ghost" onClick={() => setClosedTicket(null)}>
              Fermer
            </button>
            <PrinterHint />
            <button className="btn-primary" onClick={() => printReceipt(format)}>
              <Printer size={16} /> Imprimer
            </button>
          </div>
        }
      >
        {closedTicket && (
          <CashTicket
            session={closedTicket}
            company={company}
            format={format}
            kind="close"
          />
        )}
      </Modal>
    </div>
  );
}
