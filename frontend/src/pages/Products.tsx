import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Boxes,
  FileSpreadsheet,
  History,
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
import type { Category, Product, StockLot, Supplier } from "../types";
import Modal from "../components/Modal";
import ProductQrCode from "../components/ProductQrCode";
import BulkDelete, { SelectBox } from "../components/BulkDelete";
import { useSelection } from "../lib/selection";
import { scanCode } from "../lib/scan";
import { printLabels } from "../lib/print";
import { priceLabelHtml } from "../lib/labels";
import { exportCsv, stampedName } from "../lib/exportCsv";
import { useLicense } from "../context/LicenseContext";
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

/** One recorded price change on an article. */
interface PriceChange {
  id: number;
  field: string;
  old_value: number;
  new_value: number;
  changed_at: string;
  changed_by?: { name: string } | null;
}

const FIELD_LABEL: Record<string, string> = {
  sale_price: "Prix de vente",
  purchase_price: "Prix d'achat",
  wholesale_price: "Prix de gros",
};

/** Sales filter applied server-side: all, never sold, best sellers. */
type SoldFilter = "" | "jamais" | "top";

export default function Products() {
  const { can } = useAuth();
  const { company, printing } = useCompany();
  const { hasFeature } = useLicense();
  const version = useSyncVersion();
  const [sold, setSold] = useState<SoldFilter>("");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [qrProduct, setQrProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyItems, setHistoryItems] = useState<PriceChange[]>([]);
  const [lotsProduct, setLotsProduct] = useState<Product | null>(null);
  const [lots, setLots] = useState<StockLot[]>([]);
  const [lotForm, setLotForm] = useState({
    lot_number: "",
    expiry_date: "",
    quantity: "",
  });
  const [lotError, setLotError] = useState("");
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

  function exportExcel() {
    exportCsv(
      stampedName("produits"),
      [
        "Nom",
        "Référence",
        "Catégorie",
        "Fournisseur",
        "Prix d'achat",
        "Prix de vente",
        "Prix de gros",
        "Stock",
        "Stock minimum",
        "Code-barres",
      ],
      filtered.map((p) => [
        p.name,
        p.sku,
        categories.find((c) => c.id === p.category_id)?.name ?? "",
        suppliers.find((s) => s.id === p.supplier_id)?.name ?? "",
        p.purchase_price,
        p.sale_price,
        p.wholesale_price ?? 0,
        p.quantity,
        p.min_stock,
        p.barcode ?? "",
      ])
    )
      .then((saved) =>
        setNotice(
          saved
            ? `Export enregistré : ${saved}`
            : "Export annulé : aucun fichier enregistré."
        )
      )
      .catch(() => setError("Export impossible : le fichier n'a pas pu être créé."));
  }

  /** Sends the picked CSV to the bulk upsert endpoint and reports per row. */
  async function importCsv(file: File) {
    setError("");
    setNotice("");
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await api.post<{
        created: number;
        updated: number;
        errors: { line: number; message: string }[];
      }>("/products/import", body);
      const { created, updated, errors } = res.data;
      setNotice(
        `Import terminé : ${created} créé(s), ${updated} mis à jour` +
          (errors.length
            ? `, ${errors.length} ligne(s) en erreur (l. ${errors
                .map((e) => e.line)
                .join(", ")} : ${errors[0].message}${
                errors.length > 1 ? "…" : ""
              })`
            : ".")
      );
      await load();
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? err.response?.data?.detail ?? "Import impossible"
          : "Import impossible"
      );
    }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selection = useSelection(paged);

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

  /** Opens the price history of the article in a modal. */
  async function openHistory(p: Product) {
    setHistoryProduct(p);
    setHistoryItems([]);
    try {
      const res = await api.get<PriceChange[]>(
        `/products/${p.id}/price-history`
      );
      setHistoryItems(res.data);
    } catch {
      setHistoryItems([]);
    }
  }

  /** Opens the stock lots of the article in a modal. */
  async function openLots(p: Product) {
    setLotsProduct(p);
    setLots([]);
    setLotError("");
    setLotForm({ lot_number: "", expiry_date: "", quantity: "" });
    try {
      const res = await api.get<StockLot[]>(`/products/${p.id}/lots`);
      setLots(res.data);
    } catch {
      setLots([]);
    }
  }

  async function addLot(event: React.FormEvent) {
    event.preventDefault();
    if (!lotsProduct) return;
    setLotError("");
    try {
      await api.post(`/products/${lotsProduct.id}/lots`, {
        lot_number: lotForm.lot_number,
        expiry_date: lotForm.expiry_date
          ? `${lotForm.expiry_date}T00:00:00`
          : null,
        quantity: Number(lotForm.quantity),
      });
      setLotForm({ lot_number: "", expiry_date: "", quantity: "" });
      await openLots(lotsProduct);
      await load();
    } catch (error) {
      setLotError(
        axios.isAxiosError(error) &&
          typeof error.response?.data?.detail === "string"
          ? error.response.data.detail
          : "Enregistrement impossible."
      );
    }
  }

  async function releaseLot(lot: StockLot) {
    if (!lotsProduct) return;
    try {
      await api.delete(`/products/lots/${lot.id}`);
      await openLots(lotsProduct);
    } catch {
      setLotError("Suppression impossible.");
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
    const labels = items.map((p) =>
      priceLabelHtml(
        {
          name: p.name,
          sale_price: p.sale_price,
          wholesale_price: p.wholesale_price,
          code: scanCode(p) === p.sku ? "" : p.sku,
          barcode: scanCode(p),
        },
        company,
        printing.label
      )
    );
    printLabels(
      items.length === 1 ? `Étiquette ${items[0].sku}` : "Étiquettes de prix",
      labels.join(""),
      printing.label
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
          {hasFeature("export_excel") && (
            <button className="btn-ghost" onClick={exportExcel}>
              <FileSpreadsheet size={16} /> Exporter Excel
            </button>
          )}
          {can("produits_gerer") && (
            <>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importCsv(file);
                  e.target.value = "";
                }}
              />
              <button
                className="btn-ghost"
                onClick={() => csvInputRef.current?.click()}
              >
                <FileSpreadsheet size={16} /> Importer CSV
              </button>
            </>
          )}
          {can("produits_gerer") && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={18} /> Nouveau produit
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {can("produits_gerer") && (
        <BulkDelete
          ids={selection.ids}
          path="/products"
          noun={["produit", "produits"]}
          onDone={load}
          onClear={selection.clear}
        />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {can("produits_gerer") && (
                  <th className="px-4 py-3">
                    <SelectBox
                      checked={selection.allSelected}
                      onChange={selection.toggleAll}
                      label="Tout sélectionner"
                    />
                  </th>
                )}
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
                  {can("produits_gerer") && (
                    <td className="px-4 py-3.5">
                      <SelectBox
                        checked={selection.isSelected(p.id)}
                        onChange={() => selection.toggle(p.id)}
                        label={`Sélectionner ${p.name}`}
                      />
                    </td>
                  )}
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
                      title="Code QR de l'article" aria-label="Code QR de l'article"
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                    >
                      <QrCode size={16} />
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => printPrices([p])}
                        title="Imprimer l'étiquette de prix" aria-label="Imprimer l'étiquette de prix"
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Tag size={16} />
                      </button>
                      <button
                        onClick={() => openHistory(p)}
                        title="Historique des prix" aria-label="Historique des prix"
                        className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                      >
                        <History size={16} />
                      </button>
                      {can("stocks") && (
                        <button
                          onClick={() => openLots(p)}
                          title="Lots et péremptions" aria-label="Lots et péremptions"
                          className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        >
                          <Boxes size={16} />
                        </button>
                      )}
                      {can("produits_gerer") && (
                        <>
                          <button
                            onClick={() => openEdit(p)}
                            title="Modifier l'article" aria-label="Modifier l'article"
                            className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => remove(p)}
                            title="Supprimer l'article" aria-label="Supprimer l'article"
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
                    colSpan={can("produits_gerer") ? 9 : 8}
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

      <Modal
        open={historyProduct !== null}
        onClose={() => setHistoryProduct(null)}
        title={`Historique des prix — ${historyProduct?.name ?? ""}`}
      >
        {historyItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Aucun changement de prix enregistré.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2">Date</th>
                <th className="py-2">Prix</th>
                <th className="py-2 text-right">Ancien</th>
                <th className="py-2 text-right">Nouveau</th>
                <th className="py-2 text-right">Par</th>
              </tr>
            </thead>
            <tbody>
              {historyItems.map((h) => (
                <tr key={h.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-500">
                    {formatDateTime(h.changed_at)}
                  </td>
                  <td className="py-2 font-medium text-slate-700">
                    {FIELD_LABEL[h.field] ?? h.field}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {formatXOF(h.old_value)}
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-800">
                    {formatXOF(h.new_value)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {h.changed_by?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal
        open={lotsProduct !== null}
        onClose={() => setLotsProduct(null)}
        title={`Lots et péremptions — ${lotsProduct?.name ?? ""}`}
      >
        <div className="space-y-4">
          {can("stocks") && (
            <form
              onSubmit={(e) => void addLot(e)}
              className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4"
            >
              <input
                className="input"
                placeholder="N° de lot"
                value={lotForm.lot_number}
                onChange={(e) =>
                  setLotForm({ ...lotForm, lot_number: e.target.value })
                }
              />
              <input
                className="input"
                type="date"
                title="Date de péremption"
                value={lotForm.expiry_date}
                onChange={(e) =>
                  setLotForm({ ...lotForm, expiry_date: e.target.value })
                }
              />
              <input
                className="input"
                type="number"
                min="1"
                required
                placeholder="Quantité"
                value={lotForm.quantity}
                onChange={(e) =>
                  setLotForm({ ...lotForm, quantity: e.target.value })
                }
              />
              <button className="btn-primary" type="submit">
                Ajouter
              </button>
            </form>
          )}
          {lotError && (
            <p className="text-sm font-medium text-red-600">{lotError}</p>
          )}
          {lots.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              Aucun lot — le stock n'est pas ventilé par péremption.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2">Lot</th>
                  <th className="py-2">Péremption</th>
                  <th className="py-2 text-right">Quantité</th>
                  <th className="py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-b border-slate-50">
                    <td className="py-2 font-medium text-slate-700">
                      {lot.lot_number || `Lot ${lot.id}`}
                    </td>
                    <td className="py-2">
                      {lot.expiry_date ? (
                        <span
                          className={`font-medium ${
                            lot.days_left !== null && lot.days_left <= 0
                              ? "text-red-600"
                              : lot.days_left !== null && lot.days_left <= 30
                                ? "text-amber-600"
                                : "text-slate-600"
                          }`}
                        >
                          {formatDateTime(lot.expiry_date)}
                          {lot.days_left !== null &&
                            ` (${
                              lot.days_left <= 0
                                ? "périmé"
                                : `${lot.days_left} j`
                            })`}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-800">
                      {lot.quantity}
                    </td>
                    <td className="py-2 text-right">
                      {can("stocks") && (
                        <button
                          onClick={() => void releaseLot(lot)}
                          title="Retirer le lot (quantité rendue au stock)"
                          aria-label="Retirer le lot"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-400">
            Les ventes consomment d'abord les lots les plus proches de la
            péremption (FEFO).
          </p>
        </div>
      </Modal>
    </div>
  );
}
