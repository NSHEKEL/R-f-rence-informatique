import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { PackageCheck, Pencil, Printer } from "lucide-react";
import api, { formatDateTime, formatXOF } from "../api/client";
import type { Delivery, Order } from "../types";
import Modal from "../components/Modal";
import { documentBarcode, documentHeader, printSheet } from "../lib/print";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

export default function Livraisons() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const { can } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [form, setForm] = useState({
    address: "",
    carrier: "",
    recipient: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api.get<Delivery[]>("/orders/deliveries/all"),
        api.get<Order[]>("/orders"),
      ]);
      setDeliveries(d.data);
      setOrders(o.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  function edit(delivery: Delivery) {
    setEditing(delivery);
    setForm({
      address: delivery.address,
      carrier: delivery.carrier,
      recipient: delivery.recipient,
      note: delivery.note,
    });
  }

  async function saveDelivery() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(`/orders/deliveries/${editing.id}`, form);
      setEditing(null);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Modification impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  function print(delivery: Delivery) {
    const order = orders.find((o) => o.id === delivery.order_id);
    const rows = (order?.items ?? [])
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${formatXOF(it.unit_price)}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    const totalItems = (order?.items ?? []).reduce(
      (sum, it) => sum + it.quantity,
      0
    );
    printSheet(
      `Bon de livraison ${delivery.reference}`,
      documentHeader(company) +
        `<h2>Bon de livraison ${delivery.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(delivery.date)}` +
        `<br/>Commande : ${delivery.order_reference}` +
        `<br/>Client : ${order?.customer_name ?? ""}` +
        (delivery.address ? `<br/>Adresse : ${delivery.address}` : "") +
        (delivery.carrier ? `<br/>Livreur : ${delivery.carrier}` : "") +
        (delivery.recipient ? `<br/>Reçu par : ${delivery.recipient}` : "") +
        `</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Qté</th>` +
        `<th class="num">Prix unitaire</th>` +
        `<th class="num">Total</th></tr></thead><tbody>${rows}` +
        (order
          ? `<tr><th>Total — ${totalItems} article(s)</th>` +
            `<th class="num">${totalItems}</th><th></th>` +
            `<th class="num">${formatXOF(order.total)}</th></tr>`
          : "") +
        `</tbody></table>` +
        `<p class="meta">Signature du client :</p>` +
        documentBarcode(delivery.reference)
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Bons de livraison générés à la remise des commandes. Chaque livraison a
        décrémenté le stock et enregistré la vente correspondante.
      </p>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Bon</th>
              <th className="px-5 py-3">Date et heure</th>
              <th className="px-5 py-3">Commande</th>
              <th className="px-5 py-3 text-right">Articles</th>
              <th className="px-5 py-3">Adresse</th>
              <th className="px-5 py-3">Livreur</th>
              <th className="px-5 py-3">Reçu par</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <PackageCheck size={15} className="text-emerald-600" />
                    {d.reference}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-500">
                  {formatDateTime(d.date)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.order_reference}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {(
                    orders.find((o) => o.id === d.order_id)?.items ?? []
                  ).reduce((sum, it) => sum + it.quantity, 0)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.address || "—"}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.carrier || "—"}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.recipient || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {can("commandes_gerer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => edit(d)}
                        aria-label="Modifier la livraison"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(d)}
                      aria-label="Imprimer le bon de livraison"
                    >
                      <Printer size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  Aucune livraison.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Modifier le bon ${editing.reference}` : ""}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button
              className="btn-primary"
              onClick={saveDelivery}
              disabled={saving}
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Adresse de livraison</label>
            <input
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Livreur</label>
              <input
                className="input"
                value={form.carrier}
                onChange={(e) => setForm({ ...form, carrier: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Reçu par</label>
              <input
                className="input"
                value={form.recipient}
                onChange={(e) =>
                  setForm({ ...form, recipient: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">Remarque</label>
            <textarea
              className="input"
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-500">
            Le stock et la vente enregistrés à la livraison ne changent pas.
          </p>
        </div>
      </Modal>
    </div>
  );
}
