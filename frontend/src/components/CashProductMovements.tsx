import { useEffect, useState } from "react";
import axios from "axios";
import api, { formatDateTime } from "../api/client";
import { apiErrorMessage } from "../lib/apiErrors";
import type { CashSession } from "../types";

interface ProductTotal {
  product_id: number | null;
  product_name: string;
  sku: string;
  base_unit: string;
  entries: number;
  exits: number;
  net: number;
}

interface ProductMovements {
  depot_name: string;
  totals: { entries: number; exits: number; net: number };
  products: ProductTotal[];
  items: { id: number; type: string; product_name: string; sku: string; quantity: number;
    base_unit: string; date: string; user: string; reason: string }[];
}

export default function CashProductMovements({ session, history, version }: {
  session: CashSession; history: CashSession[]; version: number;
}) {
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState("session");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProductMovements | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = selected ? Number(selected) : session.id;
  useEffect(() => {
    let alive = true;
    setData(null); setError(""); setPage(1);
    if (period === "custom" && !from && !to) { setLoading(false); return; }
    setLoading(true);
    const params = { period, ...(period === "custom" ? { date_from: from || undefined, date_to: to || undefined } : {}) };
    api.get<ProductMovements>(`/cash-sessions/${sessionId}/product-movements`, { params })
      .then((response) => { if (alive) setData(response.data); })
      .catch((err) => { if (alive) setError(axios.isAxiosError(err)
        ? apiErrorMessage(err.response?.data?.detail, "Impossible de charger les mouvements de produits")
        : "Impossible de charger les mouvements de produits"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId, period, from, to, refresh, version]);

  return <section className="card space-y-4 p-5" aria-label="Mouvements de produits">
    <h2 className="font-bold">Mouvements de produits</h2>
    <p className="text-xs text-slate-500">Stock du dépôt de vente partagé, tous utilisateurs, limité aux heures de la session. Les quantités sont en unités de base ; le net est une variation, pas le stock disponible. Aucun mouvement d'argent n'est inclus.</p>
    <div className="flex flex-wrap gap-2">
      {history.length > 0 && <select className="input w-auto" aria-label="Session des produits" value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">Session courante #{session.id}</option>
        {history.filter((row) => row.id !== session.id).map((row) => <option key={row.id} value={row.id}>#{row.id} · {formatDateTime(row.opened_at)}</option>)}
      </select>}
      <select className="input w-auto" aria-label="Période des produits" value={period} onChange={(e) => setPeriod(e.target.value)}>
        <option value="session">Session entière</option><option value="today">Aujourd'hui</option><option value="custom">Dates personnalisées</option>
      </select>
      {period === "custom" && <>
        <input type="date" className="input w-auto" aria-label="Produits depuis" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-auto" aria-label="Produits jusqu'au" value={to} onChange={(e) => setTo(e.target.value)} />
      </>}
      <button className="btn-ghost" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading && <p className="text-sm text-slate-500">Chargement…</p>}
    {period === "custom" && !from && !to && <p className="text-sm text-slate-500">Choisissez au moins une date.</p>}
    {data && <>
      <p className="text-sm font-semibold">{data.depot_name} · Entrées : {data.totals.entries} · Sorties : {data.totals.exits} · Variation nette : {data.totals.net}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="text-left font-semibold">Totaux par produit</caption>
        <thead><tr>{["Article / SKU", "Unité", "Entrées", "Sorties", "Net"].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.products.map((row) => <tr className="border-t" key={row.product_id ?? row.product_name}>
          <td className="p-2">{row.product_name} {row.sku && `· ${row.sku}`}</td><td>{row.base_unit}</td><td>{row.entries}</td><td>{row.exits}</td><td>{row.net}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="text-left font-semibold">Historique des mouvements</caption>
        <thead><tr>{["Date / heure", "Type", "Article / SKU", "Quantité signée", "Utilisateur", "Référence / note"].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.items.slice((page - 1) * 50, page * 50).map((row) => <tr className="border-t" key={row.id}>
          <td className="p-2">{formatDateTime(row.date)}</td><td>{row.type}</td><td>{row.product_name} {row.sku && `· ${row.sku}`}</td>
          <td className={row.quantity < 0 ? "text-red-700" : "text-emerald-700"}>{row.quantity > 0 ? "+" : ""}{row.quantity} {row.base_unit}</td><td>{row.user}</td><td>{row.reason}</td>
        </tr>)}</tbody>
      </table></div>
      {data.items.length === 0 && <p className="text-sm text-slate-500">Aucun mouvement de produits sur cette période.</p>}
      <div className="flex items-center justify-between gap-2">
        <button className="btn-ghost" type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Précédent</button>
        <span className="text-xs">{data.items.length} mouvement(s) · page {page} / {Math.max(1, Math.ceil(data.items.length / 50))}</span>
        <button className="btn-ghost" type="button" disabled={page * 50 >= data.items.length} onClick={() => setPage((value) => value + 1)}>Suivant</button>
      </div>
    </>}
  </section>;
}
