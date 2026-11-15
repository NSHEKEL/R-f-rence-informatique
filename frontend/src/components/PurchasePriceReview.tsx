import { useEffect, useState } from "react";
import api, { formatXOF } from "../api/client";
import { PRICE_LABELS, priceKey, proposedPrices, type CataloguePriceChange, type ReviewProduct } from "../lib/purchasePrices";

export default function PurchasePriceReview({ purchaseId, editable, onChange, onReady }: {
  purchaseId: number;
  editable: boolean;
  onChange: (changes: CataloguePriceChange[]) => void;
  onReady: (ready: boolean) => void;
}) {
  const [products, setProducts] = useState<ReviewProduct[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    onReady(false);
    onChange([]);
    setProducts([]);
    setDrafts({});
    setError("");
    api.get<ReviewProduct[]>(`/purchases/${purchaseId}/price-review`).then(({ data }) => {
      if (alive) { setProducts(data); onReady(true); }
    }).catch(() => { if (alive) setError("Impossible de charger les prix. Fermez puis rouvrez la réception."); });
    return () => { alive = false; };
  }, [purchaseId, onChange, onReady]);

  function publish(next: Record<string, string>) {
    setDrafts(next);
    try {
      onChange(editable ? proposedPrices(products, next) : []);
      setError(""); onReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prix invalide"); onReady(false);
    }
  }

  return <section className="space-y-3 rounded-xl border border-slate-200 p-4">
    <h3 className="font-semibold">Révision des prix catalogue</h3>
    <p className="text-sm text-slate-500">Garder par défaut. Ancien → nouveau ; vide = automatique pour un prix optionnel. Seuls les articles reçus maintenant peuvent changer de prix.</p>
    {!editable && <p className="text-sm text-amber-700">Lecture seule : le droit de modifier les tarifs est requis. Vous pouvez réceptionner sans changer les prix.</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {products.map((product) => <div key={product.id} className="space-y-2 border-t border-slate-100 pt-3">
      <h4 className="font-medium">{product.name}</h4>
      {[{ ...product, id: null, name: "Article" }, ...product.packagings].map((target) => <div key={target.id ?? "base"}>
        <div className="text-xs font-semibold text-slate-500">{target.name}{target.id === null && product.packaging_unit ? ` · principal : ${product.packaging_unit}` : ""}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(target.prices).filter(([field, value]) => !(field === "semi_wholesale_price" && value === null) && !(["packaging_sale_price", "wholesale_packaging_price"].includes(field) && !product.packaging_unit)).map(([field, old]) => {
            const key = priceKey(product.id, target.id, field);
            const value = drafts[key] ?? (old === null ? "" : String(old));
            const changed = (value === "" ? null : Number(value)) !== old;
            return <label key={key} className="rounded-lg bg-slate-50 p-2 text-xs">
              <span className="block font-medium">{PRICE_LABELS[field] ?? field}</span>
              <span className={changed ? "text-amber-700" : "text-slate-500"}>Ancien : {old === null ? "Automatique" : formatXOF(old)} → {changed ? "Modifier" : "Garder"}</span>
              <span className="mt-1 block">Nouveau :</span>
              <input aria-label={`${product.name} ${target.name} ${PRICE_LABELS[field] ?? field} nouveau`} type="number" min="0" step="any" className="input mt-1 w-full" value={value} disabled={!editable} placeholder="Automatique" onChange={(event) => publish({ ...drafts, [key]: event.target.value })} />
            </label>;
          })}
        </div>
      </div>)}
      {editable && <button type="button" className="btn-ghost text-xs" onClick={() => {
        const next = Object.fromEntries(Object.entries(drafts).filter(([key]) => !key.startsWith(`${product.id}:`)));
        publish(next);
      }}>Garder tous les prix de cet article</button>}
    </div>)}
  </section>;
}
