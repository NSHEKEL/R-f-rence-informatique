import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ClipboardCheck,
  Plus,
  Printer,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import api, { formatDate, formatDateTime, formatXOF } from "../api/client";
import type { Customer, Order, Product } from "../types";
import Modal from "../components/Modal";
import { printSheet } from "../lib/print";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

interface DraftLine {
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: number;
}

const statusStyles: Record<string, string> = {
  "En attente": "bg-amber-50 text-amber-700",
  Confirmée: "bg-blue-50 text-blue-700",
  Livrée: "bg-emerald-50 text-emerald-700",
  Annulée: "bg-slate-100 text-slate-500",
};

export default function Commandes() {
  const version = useSyncVersion();
  const { company } = useCompany();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [expected, setExpected] = useState("");
  const [address, setAddress] = useState("");
  const [deposit, setDeposit] = useState(0);
  const [priceMode, setPriceMode] = useState("detail");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [delivering, setDelivering] = useState<Order | null>(null);
  const [carrier, setCarrier] = useState("");
  const [recipient, setRecipient] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [paid, setPaid] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("Espèces");

  const load = useCallback(async () => {
    try {
      const [o, p, c] = await Promise.all([
        api.get<Order[]>("/orders"),
        api.get<Product[]>("/products"),
        api.get<Customer[]>("/customers"),
      ]);
      setOrders(o.data);
      setProducts(p.data);
      setCustomers(c.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur de chargement");
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0),
    [lines]
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  }

  function pickProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    const price =
      priceMode === "gros" && product?.wholesale_price
        ? product.wholesale_price
        : product?.sale_price ?? 0;
    updateLine(index, {
      product_id: product?.id ?? null,
      product_name: product?.name ?? "",
      unit_price: price,
    });
  }

  async function save() {
    if (lines.some((l) => !l.product_id)) {
      setError("Chaque ligne doit désigner un article du catalogue");
      return;
    }
    if (lines.length === 0) {
      setError("Ajoutez au moins une ligne");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/orders", {
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName,
        expected_date: expected ? new Date(expected).toISOString() : null,
        deposit,
        price_mode: priceMode,
        delivery_address: address,
        note,
        items: lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
      });
      setOpen(false);
      setLines([]);
      setNote("");
      setCustomerName("");
      setCustomerId("");
      setExpected("");
      setAddress("");
      setDeposit(0);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.detail ?? "Erreur lors de l'enregistrement"
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelivery() {
    if (!delivering) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/orders/${delivering.id}/deliver`, {
        address: address || delivering.delivery_address,
        carrier,
        recipient,
        note: deliveryNote,
        paid,
        payment_method: paymentMethod,
      });
      setDelivering(null);
      setCarrier("");
      setRecipient("");
      setDeliveryNote("");
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Livraison impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  async function cancel(order: Order) {
    if (!window.confirm(`Supprimer la commande ${order.reference} ?`)) return;
    try {
      await api.delete(`/orders/${order.id}`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Suppression impossible");
      }
    }
  }

  function print(order: Order) {
    const rows = order.items
      .map(
        (it) =>
          `<tr><td>${it.product_name}</td>` +
          `<td class="num">${it.quantity}</td>` +
          `<td class="num">${formatXOF(it.unit_price)}</td>` +
          `<td class="num">${formatXOF(it.subtotal)}</td></tr>`
      )
      .join("");
    printSheet(
      `Commande ${order.reference}`,
      `<h1>${company?.name ?? ""}</h1>` +
        `<p class="meta">${[company?.address, company?.phone, company?.email]
          .filter(Boolean)
          .join(" · ")}</p>` +
        `<h2>Bon de commande ${order.reference}</h2>` +
        `<p class="meta">Date : ${formatDateTime(order.date)}` +
        (order.expected_date
          ? ` · Livraison prévue le ${formatDate(order.expected_date)}`
          : "") +
        `<br/>Client : ${order.customer_name || "Client de passage"}` +
        (order.delivery_address
          ? `<br/>Adresse : ${order.delivery_address}`
          : "") +
        `</p>` +
        `<table><thead><tr><th>Désignation</th><th class="num">Qté</th>` +
        `<th class="num">P.U.</th><th class="num">Total</th></tr></thead>` +
        `<tbody>${rows}<tr><th colspan="3">Total</th>` +
        `<th class="num">${formatXOF(order.total)}</th></tr>` +
        `<tr><th colspan="3">Acompte</th>` +
        `<th class="num">${formatXOF(order.deposit)}</th></tr>` +
        `<tr><th colspan="3">Reste à payer</th>` +
        `<th class="num">${formatXOF(order.balance)}</th></tr></tbody></table>` +
        (order.note ? `<p class="meta">${order.note}</p>` : "") +
        `<p class="meta">Le stock est décrémenté au moment de la ` +
        `livraison, pas à la commande.</p>`
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Commandes clients — le stock n'est décrémenté qu'à la livraison, qui
          crée automatiquement la vente correspondante.
        </p>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Nouvelle commande
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Référence</th>
              <th className="px-5 py-3">Date et heure</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Reste</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <ClipboardCheck size={15} className="text-brand-600" />
                    {o.reference}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-slate-500">
                  {formatDateTime(o.date)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {o.customer_name || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      statusStyles[o.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {o.status}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-900">
                  {formatXOF(o.total)}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {formatXOF(o.balance)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {o.status !== "Livrée" && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        onClick={() => {
                          setDelivering(o);
                          setAddress(o.delivery_address);
                          setRecipient(o.customer_name);
                        }}
                        aria-label="Livrer la commande"
                      >
                        <Truck size={16} />
                      </button>
                    )}
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      onClick={() => print(o)}
                      aria-label="Imprimer le bon de commande"
                    >
                      <Printer size={16} />
                    </button>
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => cancel(o)}
                      aria-label="Supprimer la commande"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  Aucune commande.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouvelle commande"
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
              <label className="label">Client enregistré</label>
              <select
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— Aucun —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ou nom libre</label>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Société ABC"
              />
            </div>
            <div>
              <label className="label">Livraison prévue le</label>
              <input
                type="date"
                className="input"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label">Adresse de livraison</label>
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Bondoukou, quartier..."
              />
            </div>
            <div>
              <label className="label">Tarif</label>
              <select
                className="input"
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value)}
              >
                <option value="detail">Détail</option>
                <option value="gros">Gros</option>
              </select>
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
                <div className="w-20">
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
                <div className="w-32">
                  <label className="label">P.U.</label>
                  <input
                    type="number"
                    className="input"
                    value={l.unit_price}
                    onChange={(e) =>
                      updateLine(index, { unit_price: Number(e.target.value) })
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
                  {
                    product_id: null,
                    product_name: "",
                    quantity: 1,
                    unit_price: 0,
                  },
                ])
              }
            >
              <Plus size={16} /> Ajouter une ligne
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Acompte versé</label>
              <input
                type="number"
                className="input"
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Note</label>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Conditions, délai..."
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
            <span className="text-sm font-medium uppercase">Total</span>
            <span className="text-2xl font-extrabold">{formatXOF(total)}</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={delivering !== null}
        onClose={() => setDelivering(null)}
        title={`Livrer la commande ${delivering?.reference ?? ""}`}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDelivering(null)}>
              Annuler
            </button>
            <button
              className="btn-primary"
              onClick={confirmDelivery}
              disabled={saving}
            >
              {saving ? "Livraison..." : "Valider la livraison"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            La livraison décrémente le stock et enregistre la vente
            correspondante.
          </p>
          <div>
            <label className="label">Adresse</label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Livreur / transporteur</label>
              <input
                className="input"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Réceptionné par</label>
              <input
                className="input"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Règlement</label>
              <select
                className="input"
                value={paid ? "oui" : "non"}
                onChange={(e) => setPaid(e.target.value === "oui")}
              >
                <option value="oui">Payée à la livraison</option>
                <option value="non">À crédit</option>
              </select>
            </div>
            <div>
              <label className="label">Moyen de paiement</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={!paid}
              >
                <option>Espèces</option>
                <option>Mobile Money</option>
                <option>Carte</option>
                <option>Virement</option>
              </select>
            </div>
          </div>
          <input
            className="input"
            placeholder="Note de livraison"
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
