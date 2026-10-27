import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import api, { formatXOF } from "../api/client";
import type { Category, Product, Supplier } from "../types";
import Modal from "../components/Modal";
import { stockBadge } from "../components/badges";

const empty = {
  name: "",
  sku: "",
  description: "",
  category_id: "" as number | "" | null,
  supplier_id: "" as number | "" | null,
  purchase_price: 0,
  sale_price: 0,
  quantity: 0,
  min_stock: 5,
};

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pageSize = 8;

  async function load() {
    const [p, c, s] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<Category[]>("/categories"),
      api.get<Supplier[]>("/suppliers"),
    ]);
    setProducts(p.data);
    setCategories(c.data);
    setSuppliers(s.data);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    setEditing(null);
    setForm({ ...empty });
    setError("");
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku,
      description: p.description,
      category_id: p.category_id ?? "",
      supplier_id: p.supplier_id ?? "",
      purchase_price: p.purchase_price,
      sale_price: p.sale_price,
      quantity: p.quantity,
      min_stock: p.min_stock,
    });
    setError("");
    setModalOpen(true);
  }

  async function save() {
    setError("");
    setSaving(true);
    const payload = {
      ...form,
      category_id: form.category_id === "" ? null : Number(form.category_id),
      supplier_id: form.supplier_id === "" ? null : Number(form.supplier_id),
      purchase_price: Number(form.purchase_price),
      sale_price: Number(form.sale_price),
      quantity: Number(form.quantity),
      min_stock: Number(form.min_stock),
    };
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, payload);
      } else {
        await api.post("/products", payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'enregistrement");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (!confirm(`Supprimer le produit "${p.name}" ?`)) return;
    await api.delete(`/products/${p.id}`);
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
            placeholder="Rechercher un produit ou une référence..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={18} /> Nouveau produit
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Produit</th>
                <th className="px-5 py-3">Catégorie</th>
                <th className="px-5 py-3 text-right">Prix vente</th>
                <th className="px-5 py-3 text-center">Stock</th>
                <th className="px-5 py-3 text-center">État</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.sku}</p>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {p.category?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right font-medium text-slate-800">
                    {formatXOF(p.sale_price)}
                  </td>
                  <td className="px-5 py-3.5 text-center font-semibold text-slate-700">
                    {p.quantity}
                  </td>
                  <td className="px-5 py-3.5 text-center">{stockBadge(p)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => remove(p)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                    Aucun produit trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 text-sm text-slate-500">
          <span>
            {filtered.length} produit{filtered.length > 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost px-3 py-1.5"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </button>
            <span className="px-2 font-medium text-slate-700">
              {page} / {totalPages}
            </span>
            <button
              className="btn-ghost px-3 py-1.5"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Modifier le produit" : "Nouveau produit"}
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setModalOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nom du produit</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Référence (SKU)</label>
            <input
              className="input"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Catégorie</label>
            <select
              className="input"
              value={form.category_id ?? ""}
              onChange={(e) => setForm({ ...form, category_id: e.target.value as unknown as number })}
            >
              <option value="">— Aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Fournisseur</label>
            <select
              className="input"
              value={form.supplier_id ?? ""}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value as unknown as number })}
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
            <label className="label">Prix d'achat (FCFA)</label>
            <input
              type="number"
              className="input"
              value={form.purchase_price}
              onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Prix de vente (FCFA)</label>
            <input
              type="number"
              className="input"
              value={form.sale_price}
              onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Quantité en stock</label>
            <input
              type="number"
              className="input"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Seuil d'alerte</label>
            <input
              type="number"
              className="input"
              value={form.min_stock}
              onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
