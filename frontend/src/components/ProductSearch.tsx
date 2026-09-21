import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatXOF } from "../api/client";
import type { Product } from "../types";

interface Props {
  products: Product[];
  /** Called once the cashier picks a line in the result list. */
  onPick: (product: Product) => void;
  placeholder?: string;
}

/** Find an article by name, reference, barcode or category, then add it. */
export default function ProductSearch({ products, onPick, placeholder }: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((p) =>
        [p.name, p.sku, p.barcode, p.qr_code, p.category?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, 8);
  }, [products, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          className="input pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? "Nom, référence, code-barres, catégorie"}
          title="Rechercher un article"
        />
      </div>
      {results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
          {results.map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-brand-50"
              onClick={() => {
                onPick(p);
                setQuery("");
              }}
              title="Ajouter cet article au document"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">
                  {p.name}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {p.sku || "—"}
                  {p.category?.name ? ` · ${p.category.name}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold text-slate-900">
                  {formatXOF(p.sale_price)}
                </span>
                <span
                  className={`block text-xs ${
                    p.quantity > 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  Stock {p.quantity}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
