import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Image as ImageIcon,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import api, { formatDateTime, formatXOF } from "../api/client";
import type { Category, Product, Supplier } from "../types";
import Modal from "../components/Modal";
import ProductQrCode from "../components/ProductQrCode";
import { scanCode } from "../lib/scan";
import { printLabels } from "../lib/print";
import { barcodeDataUrl } from "../lib/barcode";
import { stockBadge } from "../components/badges";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useSyncVersion } from "../context/SyncContext";

const empty = {
  name: "",
  sku: "",
  description: "",
  category_id: "" as number | "" | null,
  supplier_id: "" as number | "" | null,
  purchase_price: 0,
  sale_price: 0,
  wholesale_price: 0,
  quantity: 0,
  min_stock: 5,
  qr_code: "",
  barcode: "",
  image: "",
};

const MAX_IMAGE_BYTES = 700_000;

/** Sales filter applied server-side: all, never sold, best sellers. */
type SoldFilter = "" | "jamais" | "top";

export default function Products() {
  const { can } = useAuth();
  const { company } = useCompany();
  const version = useSyncVersion();
  const [sold, setSold] = useState<SoldFilter>("");
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
  const [qrProduct, setQrProduct] = useState<Product | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pageSize = 8;

  const load = useCallback(async () => {
    const [p, c, s] = await Promise.all([
      api.get<Product[]>("/products", { params: sold ? { sold } : {} }),
      api.get<Category[]>("/categories"),
      api.get<Supplier[]>("/suppliers"),
    ]);
    setProducts(p.data);
    setCategories(c.data);
    setSuppliers(s.data);
  }, [sold]);

  useEffect(() => {
    load();
  }, [load, version]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.qr_code || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q)
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
      wholesale_price: p.wholesale_price ?? 0,
      quantity: p.quantity,
      min_stock: p.min_stock,
      qr_code: p.qr_code ?? "",
      barcode: p.barcode ?? "",
      image: p.image ?? "",
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
      wholesale_price: Number(form.wholesale_price),
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

  async function generateBarcode() {
    try {
      const { data } = await api.get<{ barcode: string }>(
        "/products/barcode/next"
      );
      setForm((prev) => ({ ...prev, barcode: data.barcode }));
    } catch {
      setError("Impossible de générer un code-barres");
    }
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Photo trop lourde (700 Ko maximum)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setForm((prev) => ({ ...prev, image: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function remove(p: Product) {
    if (!confirm(`Supprimer le produit "${p.name}" ?`)) return;
    await api.delete(`/products/${p.id}`);
    await load();
  }

  /** Price labels to stick on the shelves, one per article. */
  function printPrices(items: Product[]) {
    if (items.length === 0) return;
    const shop = company?.name ?? "";
    const labels = items.map((p) => {
      const code = scanCode(p);
      const bars = barcodeDataUrl(code, 60);
      return (
        `<div class="label">` +
        (company?.logo
          ? `<img class="shop-logo" src="${company.logo}" alt="" />`
          : "") +
        `<p class="shop">${shop}</p>` +
        `<p class="name">${p.name}</p>` +
        `<p class="price">${formatXOF(p.sale_price)}</p>` +
        (p.wholesale_price > 0
          ? `<p class="wholesale">Gros : ${formatXOF(p.wholesale_price)}</p>`
          : "") +
        (code === p.sku ? "" : `<p class="code">${p.sku}</p>`) +
        (bars ? `<img class="qr" src="${bars}" alt="" />` : "") +
        `</div>`
      );
    });
    printLabels(
      items.length === 1 ? `Étiquette ${items[0].sku}` : "Étiquettes de prix",
      labels.join("")
    );
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
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input sm:w-56"
            value={sold}
            onChange={(e) => {
              setSold(e.target.value as SoldFilter);
              setPage(1);
            }}
            aria-label="Filtrer selon les ventes"
          >
            <option value="">Tout le catalogue</option>
            <option value="jamais">Jamais vendus</option>
            <option value="top">Les plus vendus</option>
          </select>
          <button className="btn-ghost" onClick={() => printPrices(filtered)}>
            <Printer size={16} /> Imprimer les prix
          </button>
          {can("produits_gerer") && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={18} /> Nouveau produit
            </button>
          )}
        </div>
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
                <th className="px-5 py-3">Ventes</th>
                <th className="px-5 py-3 text-center">QR</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                          <ImageIcon size={16} />
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">
                          {p.sku}
                          {p.barcode ? ` · ${p.barcode}` : ""}
                        </p>
                      </div>
                    </div>
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
                  <td className="px-5 py-3.5 text-xs text-slate-500">
                    {p.sold_quantity > 0 ? (
                      <>
                        <span className="font-semibold text-slate-700">
                          {p.sold_quantity} vendu
                          {p.sold_quantity > 1 ? "s" : ""}
                        </span>
                        {p.last_sold_at && (
                          <span className="block">
                            {formatDateTime(p.last_sold_at)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600">Jamais vendu</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => setQrProduct(p)}
                      aria-label="Code QR de l'article"
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                    >
                      <QrCode size={16} />
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => printPrices([p])}
                        aria-label="Imprimer l'étiquette de prix"
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Tag size={16} />
                      </button>
                      {can("produits_gerer") && (
                        <>
                          <button
                            onClick={() => openEdit(p)}
                            aria-label="Modifier l'article"
                            className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => remove(p)}
                            aria-label="Supprimer l'article"
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-slate-400"
                  >
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
            <label className="label">Prix de gros (FCFA, 0 = aucun)</label>
            <input
              type="number"
              className="input"
              value={form.wholesale_price}
              onChange={(e) =>
                setForm({ ...form, wholesale_price: Number(e.target.value) })
              }
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
            <label className="label">
              Code-barres de l'article (chiffres imprimés sur l'emballage)
            </label>
            <div className="flex gap-2">
              <input
                className="input"
                inputMode="numeric"
                value={form.barcode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    barcode: e.target.value.replace(/\D/g, ""),
                  })
                }
                placeholder="Scannez le code ou tapez les chiffres"
              />
              <button className="btn-ghost shrink-0" onClick={generateBarcode}>
                Générer
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              L'article n'a pas de code-barres ? Cliquez sur Générer pour en
              créer un et l'imprimer depuis la colonne QR.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">
              Code QR (laisser vide pour utiliser le SKU)
            </label>
            <input
              className="input"
              value={form.qr_code}
              onChange={(e) => setForm({ ...form, qr_code: e.target.value })}
              placeholder="Collez ici le code déjà imprimé sur l'article"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Photo de l'article</label>
            <div className="flex items-center gap-4">
              {form.image ? (
                <img
                  src={form.image}
                  alt=""
                  className="h-20 w-20 rounded-xl object-cover"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-slate-300">
                  <ImageIcon size={22} />
                </span>
              )}
              <div className="flex gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => imageInput.current?.click()}
                >
                  Choisir une photo
                </button>
                {form.image && (
                  <button
                    className="btn-ghost"
                    onClick={() => setForm({ ...form, image: "" })}
                  >
                    Retirer
                  </button>
                )}
              </div>
              <input
                ref={imageInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0])}
              />
            </div>
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

      <Modal
        open={qrProduct !== null}
        onClose={() => setQrProduct(null)}
        title="Code QR de l'article"
      >
        {qrProduct && (
          <div className="space-y-4">
            <ProductQrCode product={qrProduct} />
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
              Scannez ce code sur l'écran de vente pour ajouter l'article au
              panier (code : {scanCode(qrProduct)}).
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
