import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Ban,
  ClipboardCheck,
  Copy,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import api, { formatDateTime, formatXOF } from "../api/client";
import type { Customer, Delivery, Order, Product } from "../types";
import Modal from "../components/Modal";
import BulkDelete, { SelectBox } from "../components/BulkDelete";
import { useSelection } from "../lib/selection";
import {
  orderDocumentHtml,
  printCommercialDocument,
} from "../lib/documents";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

interface DraftLine {
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount: number;
}

const statusStyles: Record<string, string> = {
  Brouillon: "bg-slate-100 text-slate-600",
  "En attente": "bg-amber-50 text-amber-700",
  Confirmée: "bg-blue-50 text-blue-700",
  "Partiellement livrée": "bg-amber-50 text-amber-700",
  Livrée: "bg-emerald-50 text-emerald-700",
  Annulée: "bg-slate-100 text-slate-500",
};

const STATUSES = [
  "Brouillon",
  "Confirmée",
  "Partiellement livrée",
  "Livrée",
  "Annulée",
];

export default function Commandes() {
  const version = useSyncVersion();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { company, printing } = useCompany();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState("");

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [expected, setExpected] = useState("");
  const [address, setAddress] = useState("");
  const [deposit, setDeposit] = useState(0);
  const [priceMode, setPriceMode] = useState("detail");
  const [note, setNote] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [status, setStatus] = useState("Brouillon");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);


  const load = useCallback(async () => {
    try {
      const [o, p, c, d] = await Promise.all([
        api.get<Order[]>("/orders"),
        api.get<Product[]>("/products"),
        api.get<Customer[]>("/customers"),
        api.get<Delivery[]>("/delivery-notes"),
      ]);
      setOrders(o.data);
      setProducts(p.data);
      setCustomers(c.data);
      setDeliveries(d.data);
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
    () =>
      lines.reduce(
        (sum, l) => sum + Math.max(l.unit_price * l.quantity - l.discount, 0),
        0
      ),
    [lines]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (customerFilter && String(o.customer_id ?? "") !== customerFilter) {
        return false;
      }
      if (dateFilter && !o.date.startsWith(dateFilter)) return false;
      if (!needle) return true;
      return (
        o.reference.toLowerCase().includes(needle) ||
        o.customer_name.toLowerCase().includes(needle)
      );
    });
  }, [orders, search, statusFilter, customerFilter, dateFilter]);

  const selection = useSelection(visible);

  /** Delivery notes issued from an order, shown as its linked documents. */
  function linked(order: Order): string[] {
    return deliveries
      .filter((d) => d.order_id === order.id)
      .map((d) => d.reference);
  }

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

  function resetForm() {
    setEditing(null);
    setLines([]);
    setNote("");
    setCustomerName("");
    setCustomerId("");
    setExpected("");
    setAddress("");
    setDeposit(0);
    setPriceMode("detail");
    setPaymentTerms("");
    setDeliveryTerms("");
    setStatus("Brouillon");
  }

  /** Reopen a pending order to correct a line, a price or the delivery date. */
  function edit(order: Order) {
    setEditing(order);
    setCustomerId(order.customer_id ? String(order.customer_id) : "");
    setCustomerName(order.customer_name);
    setExpected(order.expected_date ? order.expected_date.slice(0, 10) : "");
    setAddress(order.delivery_address);
    setDeposit(order.deposit);
    setPriceMode(order.price_mode ?? "detail");
    setNote(order.note ?? "");
    setPaymentTerms(order.payment_terms ?? "");
    setDeliveryTerms(order.delivery_terms ?? "");
    setStatus(order.status);
    setLines(
      order.items.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit: item.unit || "u",
        unit_price: item.unit_price,
        discount: item.discount || 0,
      }))
    );
    setOpen(true);
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
      const body = {
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName,
        expected_date: expected ? new Date(expected).toISOString() : null,
        deposit,
        price_mode: priceMode,
        delivery_address: address,
        payment_terms: paymentTerms,
        delivery_terms: deliveryTerms,
        status,
        note,
        items: lines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          discount: l.discount,
        })),
      };
      if (editing) {
        await api.put(`/orders/${editing.id}`, body);
      } else {
        await api.post("/orders", body);
      }
      setOpen(false);
      resetForm();
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

  /** A4/A5 purchase order; « Enregistrer au format PDF » exports it. */
  function print(order: Order) {
    printCommercialDocument(
      `Bon de commande ${order.reference}`,
      orderDocumentHtml(order, company, printing.documents),
      printing.documents
    );
  }

  async function duplicate(order: Order) {
    try {
      await api.post(`/orders/${order.id}/duplicate`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Duplication impossible");
      }
    }
  }

  async function cancelOrder(order: Order) {
    if (!window.confirm(`Annuler le bon de commande ${order.reference} ?`)) {
      return;
    }
    try {
      await api.post(`/orders/${order.id}/cancel`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Annulation impossible");
      }
    }
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

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <label className="label">Rechercher</label>
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° de bon ou client"
            />
          </div>
        </div>
        <div className="w-44">
          <label className="label">Statut</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Tous</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <label className="label">Client</label>
          <select
            className="input"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
          >
            <option value="">Tous</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
      </div>

      {can("commandes_gerer") && (
        <BulkDelete
          ids={selection.ids}
          path="/orders"
          noun={["commande", "commandes"]}
          onDone={load}
          onClear={selection.clear}
        />
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              {can("commandes_gerer") && (
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
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Articles</th>
              <th className="px-5 py-3 text-right">Livré</th>
              <th className="px-5 py-3 text-right">Total</th>
              <th className="px-5 py-3 text-right">Reste</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50/60">
                {can("commandes_gerer") && (
                  <td className="px-4 py-3.5">
                    <SelectBox
                      checked={selection.isSelected(o.id)}
                      onChange={() => selection.toggle(o.id)}
                      label={`Sélectionner ${o.reference}`}
                    />
                  </td>
                )}
                <td className="px-5 py-3.5 font-semibold text-slate-800">
                  <span className="flex items-center gap-2">
                    <ClipboardCheck size={15} className="text-brand-600" />
                    {o.reference}
                  </span>
                  {linked(o).length > 0 && (
                    <span className="mt-1 block text-xs font-normal text-slate-400">
                      {linked(o).join(" · ")}
                    </span>
                  )}
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
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {o.items.reduce((sum, it) => sum + it.quantity, 0)}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {o.items.reduce(
                    (sum, it) => sum + (it.delivered_quantity ?? 0),
                    0
                  )}
                </td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-900">
                  {formatXOF(o.total)}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {formatXOF(o.balance)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {o.status !== "Livrée" && can("commandes_gerer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => edit(o)}
                        aria-label="Modifier la commande"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {o.status !== "Livrée" &&
                      o.status !== "Annulée" &&
                      can("documents_transformer") && (
                        <button
                          className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                          onClick={() => navigate(`/livraisons?bc=${o.id}`)}
                          aria-label="Transformer en bon de livraison"
                        >
                          <Truck size={16} />
                        </button>
                      )}
                    {can("commandes_imprimer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => print(o)}
                        aria-label="Imprimer le bon de commande"
                      >
                        <Printer size={16} />
                      </button>
                    )}
                    {can("commandes_gerer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => duplicate(o)}
                        aria-label="Dupliquer le bon de commande"
                      >
                        <Copy size={16} />
                      </button>
                    )}
                    {o.status !== "Annulée" && can("commandes_annuler") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        onClick={() => cancelOrder(o)}
                        aria-label="Annuler le bon de commande"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                    {can("commandes_gerer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => cancel(o)}
                        aria-label="Supprimer la commande"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={can("commandes_gerer") ? 10 : 9}
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
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
        title={
          editing ? `Modifier la commande ${editing.reference}` : "Nouvelle commande"
        }
        wide
        footer={
          <>
            <button
              className="btn-ghost"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Statut</label>
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="Brouillon">Brouillon</option>
                <option value="Confirmée">Confirmé</option>
              </select>
            </div>
            <div>
              <label className="label">Conditions de paiement</label>
              <input
                className="input"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="30 jours, à la livraison..."
              />
            </div>
            <div>
              <label className="label">Conditions de livraison</label>
              <input
                className="input"
                value={deliveryTerms}
                onChange={(e) => setDeliveryTerms(e.target.value)}
                placeholder="Sous 7 jours, franco..."
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
                <div className="w-24">
                  <label className="label">Unité</label>
                  <input
                    className="input"
                    value={l.unit}
                    onChange={(e) =>
                      updateLine(index, { unit: e.target.value })
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
                <div className="w-28">
                  <label className="label">Remise</label>
                  <input
                    type="number"
                    className="input"
                    value={l.discount}
                    onChange={(e) =>
                      updateLine(index, { discount: Number(e.target.value) })
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
                    unit: "u",
                    unit_price: 0,
                    discount: 0,
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

    </div>
  );
}
