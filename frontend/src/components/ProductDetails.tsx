import { useEffect, useState } from "react";
import { formatDate, formatXOF } from "../api/client";
import { readOffline } from "../lib/offlineInventory";
import { useAuth } from "../context/AuthContext";
import { productStep } from "../lib/productNavigation";
import type { Product, StockLot } from "../types";
import DepotStock from "./DepotStock";
import Modal from "./Modal";

export default function ProductDetails({ products, productId, onNavigate, onClose, onEdit, readOnly = false }: {
  products: Product[]; productId: number; onNavigate: (id: number) => void; onClose: () => void; onEdit: (product: Product) => void;
  readOnly?: boolean;
}) {
  const { can } = useAuth();
  const product = products.find((item) => item.id === productId);
  const index = products.findIndex((item) => item.id === productId);
  const previous = productStep(products, productId, -1);
  const next = productStep(products, productId, 1);
  const costs = can("rapports_financiers");
  const stockVisible = product?.quantity != null;
  const lotsAllowed = stockVisible && can("produits");
  const [lots, setLots] = useState<StockLot[]>([]);
  const [lotStatus, setLotStatus] = useState("Chargement des lots…");

  useEffect(() => {
    if (!lotsAllowed) return;
    let alive = true;
    readOffline<StockLot[]>(`/products/${productId}/lots`, `lots:${productId}`).then(({ data }) => {
      if (alive) { setLots(data); setLotStatus(data.length ? "" : "Aucun lot enregistré."); }
    }).catch(() => { if (alive) setLotStatus("Lots indisponibles. Fermez puis rouvrez la fiche pour réessayer."); });
    return () => { alive = false; };
  }, [productId, lotsAllowed]);

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
          (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
      const id = event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : null;
      if (id != null) { event.preventDefault(); onNavigate(id); }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [previous, next, onNavigate]);

  const price = (value: number | null | undefined) => value == null ? "Non configuré" : formatXOF(value);
  return <Modal open onClose={onClose} title={`Fiche article — ${product?.name ?? "Article absent"}`} fullscreen footer={<>
    <button className="btn-ghost" disabled={previous == null} onClick={() => { if (previous != null) onNavigate(previous); }}>Précédent</button>
    <span className="self-center font-semibold" aria-live="polite">{index + 1} / {products.length}</span>
    <button className="btn-ghost" disabled={next == null} onClick={() => { if (next != null) onNavigate(next); }}>Suivant</button>
    {product && can("produits_gerer") && <button disabled={readOnly} className="btn-primary" onClick={() => onEdit(product)}>Modifier</button>}
    <button className="btn-ghost" onClick={onClose}>Fermer</button>
  </>}>
    {!product ? <p role="status">Cet article n'est plus dans la liste filtrée.</p> : <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {product.image && <img src={product.image} alt={product.name} className="h-40 w-full object-contain" />}
        <div><h4 className="font-bold">Article</h4><p>{product.name}</p><p>Référence / SKU : {product.sku}</p><p>{product.active === false ? "Désactivé" : "Actif"}</p></div>
        <div><h4 className="font-bold">Classement</h4><p>Catégorie : {product.category?.name || "—"}</p><p>Fournisseur : {product.supplier?.name || "—"}</p><p>Rayon : {product.rayon || "—"}</p><p>Emplacement : {product.emplacement || "—"}</p></div>
        <div><h4 className="font-bold">Stock</h4><p>Total : {stockVisible ? `${product.quantity} ${product.base_unit || "pièces"}` : "Non autorisé"}</p>{stockVisible && <><p>Stock minimum : {product.min_stock}</p><DepotStock productId={product.id} total={product.quantity} /></>}{costs && product.stock_value != null && <p>Valeur stock : {price(product.stock_value)}</p>}</div>
      </section>
      <p className="whitespace-pre-wrap">{product.description || "Aucune description."}</p>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div><h4 className="font-bold">Codes</h4><p>Code-barres : {product.barcode || "—"}</p><p className="break-all">QR : {product.qr_code || "—"}</p>{product.barcodes?.map((code, i) => <p key={code.id ?? i} className="break-all">{code.code} · {code.label || "Sans libellé"}{code.active === false ? " (désactivé)" : ""}</p>)}</div>
        <div><h4 className="font-bold">Prix par {product.base_unit || "pièce"}</h4><p>Détail : {price(product.sale_price)}</p><p>Semi-gros : {price(product.semi_wholesale_price)}</p><p>Gros : {price(product.wholesale_price)}</p><p>Seuil semi-gros : {product.semi_wholesale_min_qty ?? "—"}</p><p>Seuil gros : {product.wholesale_min_qty ?? "—"}</p></div>
        {costs && <div><h4 className="font-bold">Achat</h4><p>Prix d'achat : {price(product.purchase_price)}</p><p>Prix fournisseur : {price(product.supplier_purchase_price)}</p></div>}
        {product.packaging_unit && <div><h4 className="font-bold">{product.packaging_unit} (principal)</h4><p>{product.units_per_packaging} {product.base_unit || "pièces"}</p><p>Détail : {price(product.packaging_sale_price)}</p><p>Semi-gros : {price(product.semi_packaging_price)}</p><p>Gros : {price(product.wholesale_packaging_price)}</p></div>}
      </section>
      <section className="overflow-x-auto"><h4 className="mb-2 font-bold">Conditionnements supplémentaires</h4>
        {!product.packagings?.length ? <p>Aucun conditionnement supplémentaire.</p> : <table className="w-full text-left text-sm"><thead><tr><th>Nom</th><th>Facteur</th><th>Code-barres</th><th>Détail</th><th>Semi-gros</th><th>Gros</th>{costs && <th>Achat</th>}<th>Statut</th></tr></thead><tbody>{product.packagings.map((pack, i) => <tr key={pack.id ?? i}><td>{pack.name}</td><td>{pack.factor}</td><td>{pack.barcode || "—"}</td><td>{price(pack.price_detail)}</td><td>{price(pack.price_semi_gros)}</td><td>{price(pack.price_gros)}</td>{costs && <td>{price(pack.purchase_price)}</td>}<td>{pack.active ? "Actif" : "Désactivé"}</td></tr>)}</tbody></table>}
      </section>
      {lotsAllowed && <section><h4 className="mb-2 font-bold">Lots et péremptions</h4>{lotStatus && <p role="status">{lotStatus}</p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Lot</th><th>Quantité restante</th><th>Péremption</th><th>Jours restants</th></tr></thead><tbody>{lots.map((lot) => <tr key={lot.id}><td>{lot.lot_number || "—"}</td><td>{lot.quantity}</td><td>{lot.expiry_date ? formatDate(lot.expiry_date) : "—"}</td><td>{lot.days_left ?? "—"}</td></tr>)}</tbody></table></div></section>}
    </div>}
  </Modal>;
}
