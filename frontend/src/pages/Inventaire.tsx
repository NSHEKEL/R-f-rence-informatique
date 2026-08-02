import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ClipboardCheck, History, RotateCcw, Search } from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { Product, StockMovement } from "../types";
import { useSyncVersion } from "../context/SyncContext";

type Counted = Record<number, string>;

const kindLabels: Record<string, string> = {
  vente: "Vente",
  inventaire: "Inventaire",
  ajustement: "Ajustement",
};

export default function Inventaire() {
  const version = useSyncVersion();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [counted, setCounted] = useState<Counted>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<StockMovement[]>("/inventory/movements", {
        params: { limit: 50 },
      }),
    ]);
    setProducts(p.data);
    setMovements(m.data);
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, query]);

  const differences = useMemo(
    () =>
      products
        .map((p) => {
          const raw = counted[p.id];
          if (raw === undefined || raw === "") return null;
          const delta = Number(raw) - p.quantity;
          return delta === 0 ? null : { product: p, delta };
        })
        .filter((d): d is { product: Product; delta: number } => d !== null),
    [products, counted]
  );

  const impact = useMemo(
    () =>
      differences.reduce(
        (sum, d) => sum + d.delta * d.product.purchase_price,
        0
      ),
    [differences]
  );

  async function apply() {
    if (differences.length === 0) {
      setError("Aucun écart à appliquer.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post("/inventory/apply", {
        note,
        lines: differences.map((d) => ({
          product_id: d.product.id,
          counted_quantity: d.product.quantity + d.delta,
        })),
      });
      setCounted({});
      setNote("");
      setMessage(`${differences.length} produit(s) ajusté(s).`);
      await load();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? "Erreur lors de l'inventaire");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ClipboardCheck size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Inventaire physique
          </h3>
          <p className="text-sm text-slate-500">
            Saisissez la quantité réellement comptée ; seuls les écarts sont
            appliqués.
          </p>
          <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              className="w-48 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Rechercher un produit..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        <div className="max-h-[24rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
                <th className="py-2">Produit</th>
                <th className="py-2">Code</th>
                <th className="py-2 text-center">Stock théorique</th>
                <th className="py-2 text-center">Compté</th>
                <th className="py-2 text-center">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const raw = counted[p.id] ?? "";
                const delta = raw === "" ? null : Number(raw) - p.quantity;
                return (
                  <tr key={p.id}>
                    <td className="py-2 font-medium text-slate-800">
                      {p.name}
                    </td>
                    <td className="py-2 text-slate-500">{p.sku}</td>
                    <td className="py-2 text-center text-slate-700">
                      {p.quantity}
                    </td>
                    <td className="py-2 text-center">
                      <input
                        className="w-20 rounded-lg border border-slate-200 py-1 text-center"
                        type="number"
                        min="0"
                        value={raw}
                        placeholder="—"
                        onChange={(e) =>
                          setCounted({ ...counted, [p.id]: e.target.value })
                        }
                      />
                    </td>
                    <td
                      className={`py-2 text-center font-semibold ${
                        delta === null || delta === 0
                          ? "text-slate-400"
                          : delta > 0
                            ? "text-emerald-600"
                            : "text-red-600"
                      }`}
                    >
                      {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <input
            className="input max-w-sm"
            placeholder="Motif / commentaire de l'inventaire"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm text-slate-500">
            {differences.length} écart(s) · impact valorisé{" "}
            <span
              className={`font-bold ${
                impact < 0 ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatXOF(impact)}
            </span>
          </p>
          <button
            className="btn-ghost"
            onClick={() => setCounted({})}
            disabled={Object.keys(counted).length === 0}
          >
            <RotateCcw size={16} /> Réinitialiser
          </button>
          <button
            className="btn-primary ml-auto"
            onClick={apply}
            disabled={saving || differences.length === 0}
          >
            {saving ? "Application..." : "Appliquer l'inventaire"}
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <History size={18} className="text-brand-600" />
          <h3 className="text-base font-bold text-slate-900">
            Mouvements de stock
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="py-2">Date</th>
              <th className="py-2">Produit</th>
              <th className="py-2">Type</th>
              <th className="py-2 text-center">Mouvement</th>
              <th className="py-2 text-center">Stock</th>
              <th className="py-2">Motif</th>
              <th className="py-2">Par</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="py-2 text-slate-500">{formatDate(m.date)}</td>
                <td className="py-2 font-medium text-slate-800">
                  {m.product_name}
                </td>
                <td className="py-2 text-slate-600">
                  {kindLabels[m.kind] ?? m.kind}
                </td>
                <td
                  className={`py-2 text-center font-semibold ${
                    m.quantity < 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </td>
                <td className="py-2 text-center text-slate-500">
                  {m.stock_before} → {m.stock_after}
                </td>
                <td className="py-2 text-slate-500">{m.reason}</td>
                <td className="py-2 text-slate-500">
                  {m.created_by?.name ?? "—"}
                </td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Aucun mouvement enregistré.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
