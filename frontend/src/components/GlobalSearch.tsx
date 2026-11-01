import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Search,
  ShoppingCart,
  Truck,
  Users,
  X,
} from "lucide-react";
import api, { formatXOF } from "../api/client";

type Hit = { id: number; label: string; hint: string; to: string };

type ProductRow = { id: number; name: string; sku: string; quantity: number };
type PartyRow = { id: number; name: string; phone: string };
type SaleRow = { id: number; reference: string; total: number; status: string };

type SearchResults = {
  products?: ProductRow[];
  customers?: PartyRow[];
  suppliers?: PartyRow[];
  sales?: SaleRow[];
};

const SECTIONS: {
  key: keyof SearchResults;
  title: string;
  icon: typeof Package;
  map: (row: ProductRow | PartyRow | SaleRow) => Hit;
}[] = [
  {
    key: "products",
    title: "Articles",
    icon: Package,
    map: (row) => {
      const p = row as ProductRow;
      return {
        id: p.id,
        label: p.name,
        hint: `${p.sku} · stock ${p.quantity}`,
        to: `/produits?q=${encodeURIComponent(p.name)}`,
      };
    },
  },
  {
    key: "customers",
    title: "Clients",
    icon: Users,
    map: (row) => {
      const c = row as PartyRow;
      return {
        id: c.id,
        label: c.name,
        hint: c.phone || "Client",
        to: "/clients",
      };
    },
  },
  {
    key: "suppliers",
    title: "Fournisseurs",
    icon: Truck,
    map: (row) => {
      const s = row as PartyRow;
      return {
        id: s.id,
        label: s.name,
        hint: s.phone || "Fournisseur",
        to: "/fournisseurs",
      };
    },
  },
  {
    key: "sales",
    title: "Ventes",
    icon: ShoppingCart,
    map: (row) => {
      const v = row as SaleRow;
      return {
        id: v.id,
        label: v.reference,
        hint: `${formatXOF(v.total)} · ${v.status}`,
        to: "/ventes",
      };
    },
  },
];

/** Search box of the top bar: one query fans out over the allowed modules. */
export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const needle = query.trim();
    if (needle.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await api.get<SearchResults>("/search", {
          params: { q: needle },
        });
        setResults(res.data);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function go(to: string) {
    setOpen(false);
    setQuery("");
    setResults(null);
    navigate(to);
  }

  const hasHits =
    results !== null && SECTIONS.some((s) => (results[s.key] ?? []).length > 0);
  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={box} className="relative w-44 sm:w-64 md:w-80">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-brand-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:focus-within:bg-slate-900">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher article, client, vente…"
          aria-label="Recherche globale"
          className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
            aria-label="Effacer la recherche"
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {loading && (
            <p className="px-3 py-2 text-xs text-slate-400">Recherche…</p>
          )}
          {!loading && !hasHits && (
            <p className="px-3 py-2 text-xs text-slate-400">
              Aucun résultat pour « {query.trim()} ».
            </p>
          )}
          {SECTIONS.map((section) => {
            const rows = results?.[section.key] ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={section.key} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                {rows.map((row) => {
                  const hit = section.map(row);
                  return (
                    <button
                      key={`${section.key}-${hit.id}`}
                      onClick={() => go(hit.to)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <section.icon
                        size={16}
                        className="shrink-0 text-slate-400"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {hit.label}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {hit.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
