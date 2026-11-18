import { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";

const FIELDS = [["purchase_price", "Prix usine pièce"], ["supplier_purchase_price", "Prix fournisseur pièce"], ["sale_price", "Détail pièce"], ["packaging_sale_price", "Détail carton principal"], ["semi_wholesale_price", "Semi-gros pièce"], ["wholesale_price", "Gros pièce"], ["wholesale_packaging_price", "Gros carton principal"], ["semi_wholesale_min_qty", "Seuil semi-gros"], ["wholesale_min_qty", "Seuil gros"]] as const;
export default function CatalogPriceSettings() {
  const { can } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { api.get<Product[]>("/settings/catalog").then(({ data }) => setProducts(data)).catch(() => setMessage("Catalogue indisponible.")); }, []);
  return <section className="card space-y-4 p-6"><h3 className="font-bold">Tarifs et seuils du catalogue</h3>
    <p>Les prix validés des ventes ne sont jamais recalculés. Le droit de modifier un prix pendant une vente reste distinct.</p>
    <select className="input" value={selected?.id ?? ""} onChange={(e) => setSelected(products.find((p) => p.id === Number(e.target.value)) || null)}><option value="">Choisir un article</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    {selected && <fieldset disabled={!can("tarifs_modifier")} className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([key, label]) => <label className="label" key={key}>{label}<input className="input" type="number" min={key.endsWith("qty") ? 1 : 0} value={selected[key] ?? ""} onChange={(e) => setSelected({ ...selected, [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}
      <button className="btn-primary" onClick={async () => { try { const { data } = await api.put<Product>(`/settings/catalog/${selected.id}`, Object.fromEntries(FIELDS.map(([key]) => [key, selected[key] ?? null]))); setSelected(data); setProducts((prev) => prev.map((p) => p.id === data.id ? data : p)); setMessage("Tarifs enregistrés."); } catch { setMessage("Tarifs ou seuils invalides, ou accès refusé."); } }}>Enregistrer les tarifs</button>
    </fieldset>}<p role="status">{message}</p>
  </section>;
}
