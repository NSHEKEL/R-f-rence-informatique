import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Eye, Plus, Search, Trash2, X } from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { Customer, Product, Sale } from "../types";
import Modal from "../components/Modal";
import { statusBadge } from "../components/badges";

interface Line {
  product_id: number;
  quantity: number;
}

const PAYMENTS = ["Espèces", "Mobile Money", "Carte bancaire", "Virement"];
const STATUSES = ["Payée", "En attente", "Annulée"];

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState<string>("");
  const [payment, setPayment] = useState(PAYMENTS[0]);
  const [status, setStatus] = useState(STATUSES[0]);
  const [lines, setLines] = useState<Line[]>([]);

  async function load() {
    const [s, p, c] = await Promise.all([
      api.get<Sale[]>("/sales"),
      api.get<Product[]>("/products"),
      api.get<Customer[]>("/customers"),
    ]);
    setSales(s.data);
    setProducts(p.data);
    setCustomers(c.data);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return sales.filter(
      (s) =>
        s.reference.toLowerCase().includes(q) ||
        (s.customer?.name ?? "").toLowerCase().includes(q)
    );
  }, [sales, query]);

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products]
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const p = productMap[l.product_id];
        return sum + (p ? p.sale_price * l.quantity : 0);
      }, 0),
    [lines, productMap]
  );

  function openCreate() {
    setCustomerId("");
    setPayment(PAYMENTS[0]);
    setStatus(STATUSES[0]);
    setLines([]);
    setError("");
    setCreateOpen(true);
  }

  function addLine() {
    const first = products[0];
    if (!first) return;
    setLines([...lines, { product_id: first.id, quantity: 1 }]);
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  async function save() {
    setError("");
    if (lines.length === 0) {
      setError("Ajoutez au moins un article.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/sales", {
        customer_id: customerId === "" ? null : Number(customerId),
        payment_method: payment,
        status,
        items: lines,
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Sale) {
    if (!confirm(`Supprimer la vente ${s.reference} ? Le stock sera réajusté.`))
      return;
    await api.delete(`/sales/${s.id}`);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Nouvelle vente
        </button>
      </div>

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
                  <td className="px-5 py-3.5 text-slate-500">{formatDate(s.date)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{s.payment_method}</td>
                  <td className="px-5 py-3.5 text-center">{statusBadge(s.status)}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-800">
                    {formatXOF(s.total)}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setDetail(s)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    Aucune vente trouvée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create sale modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nouvelle vente"
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setCreateOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement..." : "Valider la vente"}
            </button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Client</label>
            <select
              className="input"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
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
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              {PAYMENTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Statut</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Articles</label>
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={addLine}>
              <Plus size={14} /> Ajouter
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => {
              const p = productMap[line.product_id];
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={line.product_id}
                    onChange={(e) =>
                      updateLine(i, { product_id: Number(e.target.value) })
                    }
                  >
                    {products.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.name} (stock : {prod.quantity})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    className="input w-20"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(i, { quantity: Number(e.target.value) })
                    }
                  />
                  <span className="w-32 text-right text-sm font-medium text-slate-700">
                    {p ? formatXOF(p.sale_price * line.quantity) : "—"}
                  </span>
                  <button
                    onClick={() => removeLine(i)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
            {lines.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                Aucun article. Cliquez sur « Ajouter ».
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm font-medium text-slate-500">Total</span>
            <span className="text-xl font-extrabold text-slate-900">
              {formatXOF(total)}
            </span>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Vente ${detail.reference}` : ""}
        wide
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
                <p className="text-slate-400">Date</p>
                <p className="font-semibold text-slate-800">
                  {formatDate(detail.date)}
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
                    <td className="py-2.5 text-slate-800">{it.product_name}</td>
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
    </div>
  );
}
