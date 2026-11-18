import type { ProductPackaging } from "../types";
import type { ReactNode } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";

const prices = [
  ["price_detail", "Prix détail"], ["price_semi_gros", "Prix semi-gros"],
  ["price_gros", "Prix gros"], ["purchase_price", "Prix d'achat du conditionnement"],
] as const;

export default function ProductPackagings({ value, onChange, stock = 0, baseUnit = "pièce", factorCalculator }: {
  value: ProductPackaging[];
  onChange: (value: ProductPackaging[]) => void;
  stock?: number;
  baseUnit?: string;
  factorCalculator?: ReactNode;
}) {
  const reference = value.filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order)[0];
  function update(index: number, changes: Partial<ProductPackaging>) {
    if (changes.price_gros != null && changes.price_gros > 0) changes = { ...changes, price_detail: changes.price_gros };
    onChange(value.map((p, i) => i === index ? { ...p, ...changes } : p));
  }
  return <section className="col-span-full space-y-3">
    <h3 className="font-semibold">Conditionnements</h3>
    <p className="text-xs text-slate-500">Prix gros positif : le prix détail du même conditionnement suit à l'enregistrement. Prix vides : facteur × prix pièce. Retirer désactive sans effacer l'historique.</p>
    <datalist id="packaging-names">{["Colis", "Carton", "Gros", "Demi-gros", "Semi-gros", "Paquet", "Sachet", "Pièce", "Bouteille"].map((name) => <option key={name} value={name} />)}</datalist>
    {value.map((p, index) => <fieldset key={p.id ?? `new-${index}`} className={`grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-2 xl:grid-cols-4 ${p.active ? "" : "opacity-60"}`}>
      <legend>{p.name || "Nouveau conditionnement"}{!p.active && " — inactif"}</legend>
      <label className="label">Nom du conditionnement<input className="input" placeholder="Ex. Carton" list="packaging-names" value={p.name} onChange={(e) => update(index, { name: e.target.value })} /></label>
      <label className="label">Facteur (unités de base)<input className="input" type="number" min="1" step="1" value={p.factor} onChange={(e) => update(index, { factor: Number(e.target.value) })} /></label>
      {p === reference && factorCalculator}
      <label className="label">Code-barres<input className="input" placeholder="Scanner ou saisir le code du carton" value={p.barcode ?? ""} onChange={(e) => update(index, { barcode: e.target.value || null })} /></label>
      <label className="label">Ordre<input className="input" type="number" step="1" value={p.sort_order || ""} onChange={(e) => update(index, { sort_order: Number(e.target.value) })} /></label>
      {p.factor > 0 && <p className="col-span-full text-xs text-slate-500">Disponible : {Math.floor(stock / p.factor)} {p.name || "carton"} + {stock - Math.floor(stock / p.factor) * p.factor} {baseUnit || "pièce"}</p>}
      {prices.map(([key, label]) => <label key={key} className="label">{label}<input className="input" type="number" min="0" value={p[key] ?? ""} onChange={(e) => update(index, { [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}
      <button type="button" className={p.active ? "btn-danger" : "btn-secondary"} onClick={() => update(index, { active: !p.active })}>{p.active ? <Trash2 size={16} /> : <RotateCcw size={16} />}{p.active ? "Retirer" : "Réactiver"}</button>
    </fieldset>)}
    {!reference && factorCalculator}
    <button type="button" className="btn-secondary" onClick={() => onChange([...value, { name: "", factor: 1, active: true, sort_order: value.length }])}><Plus size={18} />Ajouter un conditionnement</button>
  </section>;
}
