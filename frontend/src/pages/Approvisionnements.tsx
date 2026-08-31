import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Ban,
  PackagePlus,
  Plus,
  Printer,
  Trash2,
  TruckIcon,
  X,
} from "lucide-react";
import api, { formatDate, formatDateTime, formatXOF } from "../api/client";
import type { Product, Purchase, PurchaseSummary, Supplier } from "../types";
import Modal from "../components/Modal";
import BulkDelete, { SelectBox } from "../components/BulkDelete";
import { useSelection } from "../lib/selection";
import { documentBarcode, documentHeader, printSheet } from "../lib/print";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

interface DraftLine {
  product_id: number | null;
  quantity: number;
  unit_cost: number;
}

const statusStyles: Record<string, string> = {
  "En attente": "bg-amber-50 text-amber-700",
  "Reçu partiellement": "bg-blue-50 text-blue-700",
  Reçu: "bg-emerald-50 text-emerald-700",
  Annulé: "bg-slate-100 text-slate-500",
};

const OPEN_STATUSES = ["En attente", "Reçu partiellement"];

export default function Approvisionnements() {
  const version = useSyncVersion();
  const { can } = useAuth();
  const { company } = useCompany();
  const manage = can("approvisionnements_gerer");

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [expected, setExpected] = useState("");
  const [invoice, setInvoice] = useState("");
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [received, setReceived] = useState<Record<number, number>>({});
  const [updateCost, setUpdateCost] = useState(true);

  const selection = useSelection(purchases);

  const load = useCallback(async () => {
    try {
      const [p, s, prod, sup] = await Promise.all([
        api.get<Purchase[]>("/purchases", {
          params: statusFilter ? { status: statusFilter } : undefined,
        }),
        api.get<PurchaseSummary>("/purchases/summary"),
        api.get<Product[]>("/products"),
        api.get<Supplier[]>("/suppliers"),
      ]);
      setPurchases(p.data);
      setSummary(s.data);
      setProducts(prod.data);
      setSuppliers(sup.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load, version]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.unit_cost * l.quantity, 0),
    [lines]
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function pickProduct(index: number, value: string) {
    const product = products.find((p) => String(p.id) === value);
    updateLine(index, {
      product_id: product?.id ?? null,
      unit_cost: product?.purchase_price ?? 0,
    });
  }

  function resetForm() {
    setLines([]);
    setSupplierId("");
    setSupplierName("");
    setExpected("");
    setInvoice("");
    setPaidAmount(0);
    setNote("");
  }

  async function save() {
    if (lines.length === 0) {
      setError("Ajoutez au moins une ligne");
      return;
    }
    if (lines.some((l) => !l.product_id)) {
      setError("Chaque ligne doit désigner un article du catalogue");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/purchases", {
        supplier_id: supplierId ? Number(supplierId) : null,
        supplier_name: supplierName,
        expected_date: expected ? new Date(expected).toISOString() : null,
        paid: paidAmount,
        invoice_number: invoice,
        note,
        items: lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
        })),
      });
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  function startReceive(purchase: Purchase) {
    setReceiving(purchase);
    setReceived(
      Object.fromEntries(
        purchase.items.map((it) => [
          it.id,
          Math.max(it.quantity - it.received_quantity, 0),
        ])
      )
    );
  }

  async function confirmReceive() {
    if (!receiving) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/purchases/${receiving.id}/receive`, {
        items: Object.entries(received).map(([id, quantity]) => ({
          item_id: Number(id),
          quantity,
        })),
        update_cost: updateCost,
      });
      setReceiving(null);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Réception impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  async function cancel(purchase: Purchase) {
    if (!window.confirm(`Annuler l'approvisionnement ${purchase.reference} ?`))
      return;
    try {
      await api.post(`/purchases/${purchase.id}/cancel`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Annulation impossible");
      }
    }
  }

  async function remove(purchase: Purchase) {
    if (!window.confirm(`Supprimer l'approvisionnement ${purchase.reference} ?`))
      return;
    try {
      await api.delete(`/purchases/${purchase.id}`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Suppression impossible");
      }
    }
  }

  function print(purchase: Purchase) {
    const rows = purchase.items
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${it.received_quantity}</td>` +
          `<td class="num">${formatXOF(it.unit_cost)}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    printSheet(
      `Approvisionnement ${purchase.reference}`,
      documentHeader(company) +
        `<h2>Bon d'approvisionnement ${purchase.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(purchase.date)}` +
        (purchase.expected_date
          ? ` · Livraison attendue le ${formatDate(purchase.expected_date)}`
          : "") +
        `<br/>Fournisseur : ${purchase.supplier_name || "—"}` +
        (purchase.invoice_number
          ? `<br/>Facture fournisseur : ${purchase.invoice_number}`
          : "") +
        `<br/>Statut : ${purchase.status}</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Commandé</th>` +
        `<th class="num">Reçu</th><th class="num">Coût unitaire</th>` +
        `<th class="num">Total</th></tr></thead>` +
        `<tbody>${rows}<tr><th colspan="4">Total</th>` +
        `<th class="num">${formatXOF(purchase.total)}</th></tr>` +
        `<tr><th colspan="4">Réglé</th>` +
        `<th class="num">${formatXOF(purchase.paid)}</th></tr>` +
        `<tr><th colspan="4">Reste à payer</th>` +
        `<th class="num">${formatXOF(purchase.balance)}</th></tr></tbody></table>` +
        (purchase.note ? `<p class="meta">${purchase.note}</p>` : "") +
        documentBarcode(purchase.reference)
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Approvisionnement : commandes passées aux fournisseurs. Le stock
          n'augmente qu'à la réception, totale ou partielle.
        </p>
        <div className="flex items-center gap-2">
          <select
            className="input w-48"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Tous les statuts</option>
            {["En attente", "Reçu partiellement", "Reçu", "Annulé"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {manage && (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Nouvel approvisionnement
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["Approvisionnements", String(summary.count)],
            ["En attente de réception", String(summary.pending)],
            ["Montant total", formatXOF(summary.total)],
            ["Reste à payer", formatXOF(summary.unpaid)],
          ].map(([label, value]) => (
            <div key={label} className="card px-5 py-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-1 text-xl font-extrabold text-slate-900">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {manage && (
        <BulkDelete
          ids={selection.ids}
          path="/purchases"
          noun={["approvisionnement", "approvisionnements"]}
          onDone={load}
          onClear={selection.clear}
        />
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              {manage && (
                <th className="px-4 py-3">
                  <SelectBox
                    checked={selection.allSelected}
                    onChange={selection.toggleAll}
                    label="Tout sélectionner"
                  />
                </th>
              )}
              <th className="px-5 py-3">Référence</th>
              <th className="px-5 py-3">Date et heure</th>
              <th className="px-5 py-3">Fournisseur</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Reste</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {purchases.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/60">
                {manage && (
                  <td className="px-4 py-3.5">
                    <SelectBox
                      checked={selection.isSelected(p.id)}
                      onChange={() => selection.toggle(p.id)}
                      label={`Sélectionner ${p.reference}`}
                    />
                  </td>
                )}
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <PackagePlus size={15} className="text-brand-600" />
                    {p.reference}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-500">
                  {formatDateTime(p.date)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {p.supplier_name || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      statusStyles[p.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-900">
                  {formatXOF(p.total)}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {formatXOF(p.balance)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {manage && OPEN_STATUSES.includes(p.status) && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        onClick={() => startReceive(p)}
                        aria-label="Réceptionner"
                      >
                        <TruckIcon size={16} />
                      </button>
                    )}
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(p)}
                      aria-label="Imprimer le bon"
                    >
                      <Printer size={16} />
                    </button>
                    {manage && p.status !== "Annulé" && p.status !== "Reçu" && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        onClick={() => cancel(p)}
                        aria-label="Annuler"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                    {manage && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove(p)}
                        aria-label="Supprimer"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {purchases.length === 0 && (
              <tr>
                <td
                  colSpan={manage ? 8 : 7}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  Aucun approvisionnement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouvel approvisionnement"
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Fournisseur enregistré</label>
              <select
                className="input"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ou nom libre</label>
              <input
                className="input"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Grossiste ABC"
              />
            </div>
            <div>
              <label className="label">Livraison attendue le</label>
              <input
                type="date"
                className="input"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((l, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="label">Article</label>
                  <select
                    className="input"
                    value={l.product_id ?? ""}
                    onChange={(e) => pickProduct(index, e.target.value)}
                  >
                    <option value="">— Choisir —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.quantity} en stock)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="label">Qté</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={l.quantity}
                    onChange={(e) =>
                      updateLine(index, { quantity: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="w-36">
                  <label className="label">Coût d'achat</label>
                  <input
                    type="number"
                    className="input"
                    value={l.unit_cost}
                    onChange={(e) =>
                      updateLine(index, { unit_cost: Number(e.target.value) })
                    }
                  />
                </div>
                <button
                  className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                  aria-label="Retirer la ligne"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="btn-ghost"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { product_id: null, quantity: 1, unit_cost: 0 },
                ])
              }
            >
              <Plus size={16} /> Ajouter une ligne
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Facture fournisseur</label>
              <input
                className="input"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                placeholder="FA-2026-001"
              />
            </div>
            <div>
              <label className="label">Montant déjà réglé</label>
              <input
                type="number"
                className="input"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Note</label>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Conditions, transport..."
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
            <span className="text-sm font-medium uppercase">Total achat</span>
            <span className="text-2xl font-extrabold">{formatXOF(total)}</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={receiving !== null}
        onClose={() => setReceiving(null)}
        title={`Réception ${receiving?.reference ?? ""}`}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setReceiving(null)}>
              Annuler
            </button>
            <button
              className="btn-primary"
              onClick={confirmReceive}
              disabled={saving}
            >
              {saving ? "Réception..." : "Valider la réception"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Les quantités saisies entrent immédiatement en stock et sont
            tracées dans les mouvements. Laissez une ligne à 0 pour la recevoir
            plus tard.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2">Article</th>
                <th className="py-2 text-right">Attendu</th>
                <th className="py-2 text-right">Reçu maintenant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receiving?.items.map((it) => {
                const remaining = it.quantity - it.received_quantity;
                return (
                  <tr key={it.id}>
                    <td className="py-2">{it.product_name}</td>
                    <td className="py-2 text-right text-slate-500">
                      {remaining}
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        className="input w-24 text-right"
                        value={received[it.id] ?? 0}
                        onChange={(e) =>
                          setReceived((prev) => ({
                            ...prev,
                            [it.id]: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={updateCost}
              onChange={(e) => setUpdateCost(e.target.checked)}
            />
            Mettre à jour le prix d'achat des articles reçus
          </label>
        </div>
      </Modal>
    </div>
  );
}
