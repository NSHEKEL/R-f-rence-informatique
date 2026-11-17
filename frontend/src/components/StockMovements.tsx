import { useEffect, useState } from "react";
import { formatDateTime } from "../api/client";
import { readOffline } from "../lib/offlineInventory";
import { useOnline } from "../lib/useOnline";
import OfflineBanner from "./OfflineBanner";
import type { Product, StockMovement } from "../types";
import { formatQuantity } from "../lib/units";

const periods = [["all", "Toutes les dates"], ["today", "Aujourd'hui"], ["7d", "7 derniers jours"], ["month", "Ce mois"], ["previous", "Mois précédent"], ["custom", "Personnalisée"]];
export default function StockMovements({ products, version }: { products: Product[]; version: number }) {
  const [filters, setFilters] = useState({ period: "all", product_id: "", search: "", kind: "", user_id: "", depot_id: "", direction: "", sort: "recent", date_from: "", date_to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: StockMovement[]; total: number }>({ items: [], total: 0 });
  const [options, setOptions] = useState<{ kinds: string[]; users: { id: number; name: string }[]; depots: { id: number; name: string }[]; products: { id: number; name: string }[] }>({ kinds: [], users: [], depots: [], products: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const online = useOnline();
  const [cached, setCached] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => { let alive = true; readOffline<typeof options>("/inventory/movements/filters", "movement-filters").then(({ data }) => { if (alive) setOptions(data); }).catch(() => { if (alive) setError("Filtres indisponibles"); }); return () => { alive = false; }; }, [version, products]);
  useEffect(() => {
    let alive = true;
    setError(""); setLoading(true); setData({ items: [], total: 0 });
    if (filters.period === "custom" && !filters.date_from && !filters.date_to) { setLoading(false); return; }
    const params: Record<string, string | number> = { page, page_size: 50 };
    for (const [key, value] of Object.entries(filters)) if (value && (filters.period === "custom" || !key.startsWith("date_"))) params[key] = value;
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    readOffline<typeof data>(`/inventory/movements/page?${query}`, `movements:${query}`).then((result) => { if (alive) { setData(result.data); setCached(result.fromCache); setSavedAt(result.savedAt); } }).catch(() => { if (alive) setError("Chargement impossible : vérifiez les dates, vos droits ou préparez ce filtre en ligne."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters, page, version, products, online]);
  function change(key: keyof typeof filters, value: string) { setPage(1); setFilters((previous) => ({ ...previous, [key]: value })); }
  return <section className="card space-y-3 overflow-x-auto p-5"><h3 className="font-bold">Mouvements de stock</h3>
    <OfflineBanner visible={!online || cached} since={savedAt} />
    <div className="flex flex-wrap gap-2">
      <select className="input w-auto" aria-label="Période des mouvements" value={filters.period} onChange={(e) => change("period", e.target.value)}>{periods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="input w-auto" aria-label="Ordre des mouvements" value={filters.sort} onChange={(e) => change("sort", e.target.value)}><option value="recent">Récent → ancien</option><option value="oldest">Ancien → récent</option></select>
      <select className="input w-auto" aria-label="Article des mouvements" value={filters.product_id} onChange={(e) => change("product_id", e.target.value)}><option value="">Tous les articles</option>{options.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <input className="input w-auto" aria-label="Rechercher un mouvement par article" placeholder="Nom historique de l'article" value={filters.search} onChange={(e) => change("search", e.target.value)} />
      <select className="input w-auto" aria-label="Type de mouvement" value={filters.kind} onChange={(e) => change("kind", e.target.value)}><option value="">Tous les types</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select>
      <select className="input w-auto" aria-label="Auteur du mouvement" value={filters.user_id} onChange={(e) => change("user_id", e.target.value)}><option value="">Tous les utilisateurs</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
      <select className="input w-auto" aria-label="Dépôt du mouvement" value={filters.depot_id} onChange={(e) => change("depot_id", e.target.value)}><option value="">Tous les dépôts</option>{options.depots.map((depot) => <option key={depot.id} value={depot.id}>{depot.name}</option>)}</select>
      <select className="input w-auto" aria-label="Sens du mouvement" value={filters.direction} onChange={(e) => change("direction", e.target.value)}><option value="">Entrées et sorties</option><option value="entree">Entrées</option><option value="sortie">Sorties</option></select>
      {filters.period === "custom" && <><input className="input w-auto" type="date" aria-label="Mouvements depuis" value={filters.date_from} onChange={(e) => change("date_from", e.target.value)} /><input className="input w-auto" type="date" aria-label="Mouvements jusqu'au" value={filters.date_to} onChange={(e) => change("date_to", e.target.value)} /></>}
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <table className="w-full text-sm"><thead><tr>{["Date", "Article", "Type", "Mouvement", "Stock", "Motif", "Par", "Dépôt"].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>
      {data.items.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="p-2">{formatDateTime(row.date)}</td><td className="p-2">{row.product_name}</td><td className="p-2">{row.kind}</td><td className={`p-2 ${row.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatQuantity(row, row.quantity)}</td><td className="p-2">{formatQuantity(row, row.stock_before)} → {formatQuantity(row, row.stock_after)}</td><td className="p-2">{row.reason}</td><td className="p-2">{row.created_by?.name ?? "—"}</td><td className="p-2">{options.depots.find((depot) => depot.id === row.depot_id)?.name ?? "Principal (historique)"}</td></tr>)}
      {!data.items.length && <tr><td colSpan={8} className="p-5 text-center">{loading ? "Chargement…" : filters.period === "custom" && !filters.date_from && !filters.date_to ? "Choisissez une date." : "Aucun mouvement."}</td></tr>}
    </tbody></table>
    <div className="flex items-center justify-between gap-3"><button className="btn-ghost" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Précédent</button><span>{data.total} mouvement(s) · page {page} / {Math.max(1, Math.ceil(data.total / 50))}</span><button className="btn-ghost" disabled={loading || page * 50 >= data.total} onClick={() => setPage(page + 1)}>Suivant</button></div>
  </section>;
}
