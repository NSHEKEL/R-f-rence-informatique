import type { ProductPackaging } from "../types";

const prices = [
  ["price_detail", "Prix détail"], ["price_semi_gros", "Prix semi-gros"],
  ["price_gros", "Prix gros"], ["purchase_price", "Prix d'achat du conditionnement"],
] as const;

export default function ProductPackagings({ value, onChange }: {
  value: ProductPackaging[];
  onChange: (value: ProductPackaging[]) => void;
}) {
  function update(index: number, changes: Partial<ProductPackaging>) {
    onChange(value.map((p, i) => i === index ? { ...p, ...changes } : p));
  }
  return <section className="space-y-3 sm:col-span-2">
    <h3 className="font-semibold">Conditionnements</h3>
    <p className="text-xs text-slate-500">Le conditionnement principal reste inchangé. Prix vides : facteur × prix pièce du tarif. Retirer désactive sans effacer l'historique.</p>
    <datalist id="packaging-names">{["Colis", "Carton", "Gros", "Demi-gros", "Semi-gros", "Paquet", "Sachet", "Pièce", "Bouteille"].map((name) => <option key={name} value={name} />)}</datalist>
    {value.map((p, index) => <fieldset key={p.id ?? `new-${index}`} className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-2 ${p.active ? "" : "opacity-60"}`}>
      <legend>{p.name || "Nouveau conditionnement"}{!p.active && " — inactif"}</legend>
      <label className="label">Nom libre<input className="input" list="packaging-names" value={p.name} onChange={(e) => update(index, { name: e.target.value })} /></label>
      <label className="label">Facteur (unités de base)<input className="input" type="number" min="1" step="1" value={p.factor} onChange={(e) => update(index, { factor: Number(e.target.value) })} /></label>
      <label className="label">Code-barres<input className="input" value={p.barcode ?? ""} onChange={(e) => update(index, { barcode: e.target.value || null })} /></label>
      <label className="label">Ordre<input className="input" type="number" step="1" value={p.sort_order} onChange={(e) => update(index, { sort_order: Number(e.target.value) })} /></label>
      {prices.map(([key, label]) => <label key={key} className="label">{label}<input className="input" type="number" min="0" value={p[key] ?? ""} onChange={(e) => update(index, { [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}
      <button type="button" className="btn-secondary" onClick={() => update(index, { active: !p.active })}>{p.active ? "Retirer" : "Réactiver"}</button>
    </fieldset>)}
    <button type="button" className="btn-secondary" onClick={() => onChange([...value, { name: "", factor: 1, active: true, sort_order: value.length }])}>Ajouter un conditionnement</button>
  </section>;
}
