import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  Ban,
  CheckCircle2,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import api, { formatDateTime } from "../api/client";
import type { Customer, Delivery, Order, Product } from "../types";
import Modal from "../components/Modal";
import {
  deliveryDocumentHtml,
  printCommercialDocument,
} from "../lib/documents";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

/** One line of the note being written: what is ordered and what leaves today. */
interface DraftLine {
  product_id: number | null;
  product_name: string;
  ordered: number;
  delivered: number;
  quantity: number;
  unit: string;
  observation: string;
}

const statusStyles: Record<string, string> = {
  Brouillon: "bg-slate-100 text-slate-600",
  Validé: "bg-emerald-50 text-emerald-700",
  Annulé: "bg-slate-100 text-slate-500",
};

const STATUSES = ["Brouillon", "Validé", "Annulé"];

export default function Livraisons() {
  const version = useSyncVersion();
  const { company, printing } = useCompany();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [orderId, setOrderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [carrier, setCarrier] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const showPrices =
    printing.documents.show_prices_on_delivery && can("livraisons_prix");

  const load = useCallback(async () => {
    try {
      const [d, o, p, c] = await Promise.all([
        api.get<Delivery[]>("/delivery-notes"),
        api.get<Order[]>("/orders"),
        api.get<Product[]>("/products"),
        api.get<Customer[]>("/customers"),
      ]);
      setDeliveries(d.data);
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

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (dateFilter && !d.date.startsWith(dateFilter)) return false;
      if (!needle) return true;
      return (
        d.reference.toLowerCase().includes(needle) ||
        d.customer_name.toLowerCase().includes(needle) ||
        d.order_reference.toLowerCase().includes(needle)
      );
    });
  }, [deliveries, search, statusFilter, dateFilter]);

  function resetForm() {
    setEditing(null);
    setOrderId("");
    setCustomerId("");
    setCustomerName("");
    setAddress("");
    setCarrier("");
    setRecipient("");
    setNote("");
    setLines([]);
  }

  /** Takes over an order: same customer, same lines, only the backlog left. */
  const fromOrder = useCallback(
    (order: Order) => {
      setOrderId(String(order.id));
      setCustomerId(order.customer_id ? String(order.customer_id) : "");
      setCustomerName(order.customer_name);
      setAddress(order.delivery_address);
      setRecipient(order.customer_name);
      setLines(
        order.items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          ordered: item.quantity,
          delivered: item.delivered_quantity ?? 0,
          quantity: item.remaining_quantity ?? 0,
          unit: item.unit || "u",
          observation: "",
        }))
      );
      setOpen(true);
    },
    []
  );

  // Arriving from « Transformer en bon de livraison » on the order screen.
  useEffect(() => {
    const wanted = params.get("bc");
    if (!wanted) return;
    const order = orders.find((o) => String(o.id) === wanted);
    if (!order) return;
    fromOrder(order);
    params.delete("bc");
    setParams(params, { replace: true });
  }, [orders, params, setParams, fromOrder]);

  function pickOrder(value: string) {
    if (!value) {
      resetForm();
      return;
    }
    const order = orders.find((o) => String(o.id) === value);
    if (order) fromOrder(order);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  }

  function pickProduct(index: number, value: string) {
    const product = products.find((p) => String(p.id) === value);
    updateLine(index, {
      product_id: product?.id ?? null,
      product_name: product?.name ?? "",
    });
  }

  function edit(delivery: Delivery) {
    setEditing(delivery);
    setOrderId(delivery.order_id ? String(delivery.order_id) : "");
    setCustomerId(delivery.customer_id ? String(delivery.customer_id) : "");
    setCustomerName(delivery.customer_name);
    setAddress(delivery.address);
    setCarrier(delivery.carrier);
    setRecipient(delivery.recipient);
    setNote(delivery.note);
    setLines(
      delivery.items.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        ordered: item.ordered_quantity,
        delivered: item.previously_delivered,
        quantity: item.quantity,
        unit: item.unit || "u",
        observation: item.observation,
      }))
    );
    setOpen(true);
  }

  async function save() {
    const kept = lines.filter((l) => l.quantity > 0);
    if (kept.some((l) => !l.product_id)) {
      setError("Chaque ligne doit désigner un article du catalogue");
      return;
    }
    if (kept.length === 0) {
      setError("Indiquez au moins une quantité à livrer");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        order_id: orderId ? Number(orderId) : null,
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerName,
        address,
        carrier,
        recipient,
        note,
        items: kept.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit: l.unit,
          observation: l.observation,
        })),
      };
      if (editing) {
        await api.put(`/delivery-notes/${editing.id}`, body);
      } else {
        await api.post("/delivery-notes", body);
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Enregistrement impossible");
      }
    } finally {
      setSaving(false);
    }
  }

  async function act(delivery: Delivery, action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    try {
      await api.post(`/delivery-notes/${delivery.id}/${action}`, {});
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Opération impossible");
      }
    }
  }

  async function remove(delivery: Delivery) {
    if (!window.confirm(`Supprimer le bon ${delivery.reference} ?`)) return;
    try {
      await api.delete(`/delivery-notes/${delivery.id}`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Suppression impossible");
      }
    }
  }

  function print(delivery: Delivery) {
    printCommercialDocument(
      `Bon de livraison ${delivery.reference}`,
      deliveryDocumentHtml(
        delivery,
        company,
        printing.documents,
        showPrices
      ),
      printing.documents
    );
  }

  const selectedOrder = orders.find((o) => String(o.id) === orderId);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Bons de livraison — un brouillon ne touche pas au stock ; la
          validation sort uniquement les quantités réellement livrées.
        </p>
        {can("livraisons_gerer") && (
          <button
            className="btn-primary"
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nouveau bon de livraison
          </button>
        )}
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
              placeholder="N° de bon, commande ou client"
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Bon</th>
              <th className="px-5 py-3">Date et heure</th>
              <th className="px-5 py-3">Commande</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Articles livrés</th>
              <th className="px-5 py-3">Livreur</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((d) => (
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
                  {d.order_reference || "—"}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.customer_name || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      statusStyles[d.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {d.status}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">
                  {d.items.reduce((sum, it) => sum + it.quantity, 0)}
                </td>
                <td className="px-5 py-3.5 text-slate-600">
                  {d.carrier || "—"}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1">
                    {d.status === "Brouillon" && can("livraisons_gerer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => edit(d)}
                        aria-label="Modifier le bon de livraison"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {d.status === "Brouillon" && can("livraisons_valider") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        onClick={() =>
                          act(
                            d,
                            "validate",
                            `Valider ${d.reference} ? Le stock sera décrémenté.`
                          )
                        }
                        aria-label="Valider le bon de livraison"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                    {can("livraisons_imprimer") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        onClick={() => print(d)}
                        aria-label="Imprimer le bon de livraison"
                      >
                        <Printer size={16} />
                      </button>
                    )}
                    {d.status !== "Annulé" && can("livraisons_annuler") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        onClick={() =>
                          act(d, "cancel", `Annuler le bon ${d.reference} ?`)
                        }
                        aria-label="Annuler le bon de livraison"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                    {d.status === "Brouillon" && can("livraisons_annuler") && (
                      <button
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove(d)}
                        aria-label="Supprimer le bon de livraison"
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
                  colSpan={8}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  Aucun bon de livraison.
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
          editing
            ? `Modifier le bon ${editing.reference}`
            : "Nouveau bon de livraison"
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
              {saving ? "Enregistrement..." : "Enregistrer le brouillon"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Bon de commande</label>
              <select
                className="input"
                value={orderId}
                onChange={(e) => pickOrder(e.target.value)}
                disabled={editing !== null}
              >
                <option value="">— Livraison directe —</option>
                {orders
                  .filter(
                    (o) => o.status !== "Annulée" && o.status !== "Livrée"
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.reference} — {o.customer_name || "Client de passage"}
                    </option>
                  ))}
              </select>
            </div>
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
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Adresse de livraison</label>
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Livreur</label>
              <input
                className="input"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Reçu par</label>
              <input
                className="input"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2">Article</th>
                  {selectedOrder && (
                    <>
                      <th className="py-2 text-right">Commandé</th>
                      <th className="py-2 text-right">Déjà livré</th>
                      <th className="py-2 text-right">Restant</th>
                    </>
                  )}
                  <th className="py-2 text-right">À livrer</th>
                  <th className="py-2">Unité</th>
                  <th className="py-2">Observation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, index) => {
                  const remaining = Math.max(l.ordered - l.delivered, 0);
                  return (
                    <tr key={index}>
                      <td className="py-1.5 pr-2">
                        {selectedOrder ? (
                          l.product_name
                        ) : (
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
                        )}
                      </td>
                      {selectedOrder && (
                        <>
                          <td className="py-1.5 text-right">{l.ordered}</td>
                          <td className="py-1.5 text-right">{l.delivered}</td>
                          <td className="py-1.5 text-right font-semibold">
                            {remaining}
                          </td>
                        </>
                      )}
                      <td className="py-1.5 pl-2">
                        <input
                          type="number"
                          min={0}
                          max={selectedOrder ? remaining : undefined}
                          className="input w-24 text-right"
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(index, {
                              quantity: selectedOrder
                                ? Math.min(Number(e.target.value), remaining)
                                : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          className="input w-20"
                          value={l.unit}
                          onChange={(e) =>
                            updateLine(index, { unit: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          className="input"
                          value={l.observation}
                          onChange={(e) =>
                            updateLine(index, { observation: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-1.5 pl-2">
                        {!selectedOrder && (
                          <button
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() =>
                              setLines((prev) =>
                                prev.filter((_, i) => i !== index)
                              )
                            }
                            aria-label="Retirer la ligne"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!selectedOrder && (
            <button
              className="btn-ghost"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    product_id: null,
                    product_name: "",
                    ordered: 0,
                    delivered: 0,
                    quantity: 1,
                    unit: "u",
                    observation: "",
                  },
                ])
              }
            >
              <Plus size={16} /> Ajouter une ligne
            </button>
          )}

          <div>
            <label className="label">Observations</label>
            <textarea
              className="input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Le bon est enregistré en brouillon : le stock ne bougera qu'à la
            validation, et seulement des quantités livrées.
            {showPrices
              ? ""
              : " Les prix ne sont pas imprimés sur le bon de livraison."}
          </p>
        </div>
      </Modal>
    </div>
  );
}
