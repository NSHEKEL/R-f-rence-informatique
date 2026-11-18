export interface ReviewPackaging {
  id: number;
  name: string;
  prices: Record<string, number | null>;
}

export interface ReviewProduct extends ReviewPackaging {
  packaging_unit: string;
  packagings: ReviewPackaging[];
}

export interface CataloguePriceChange {
  product_id: number;
  packaging_id: number | null;
  field: string;
  old_value: number | null;
  new_value: number | null;
}

export function priceKey(productId: number, packagingId: number | null, field: string) {
  return `${productId}:${packagingId ?? "base"}:${field}`;
}

export function proposedPrices(products: ReviewProduct[], drafts: Record<string, string>): CataloguePriceChange[] {
  const changes: CataloguePriceChange[] = [];
  for (const product of products) {
    for (const target of [{ ...product, id: null }, ...product.packagings]) {
      for (const [field, oldValue] of Object.entries(target.prices)) {
        const value = drafts[priceKey(product.id, target.id, field)];
        if (value === undefined) continue;
        const newValue = value === "" ? null : Number(value);
        if (newValue !== null && (!Number.isFinite(newValue) || newValue < 0)) throw new Error("Les prix doivent être des nombres positifs ou nuls.");
        if (target.id === null && ["purchase_price", "sale_price", "wholesale_price"].includes(field) && newValue === null) throw new Error("Les prix d'achat, détail et gros ne peuvent pas être vides.");
        if (newValue !== oldValue) changes.push({ product_id: product.id, packaging_id: target.id, field, old_value: oldValue, new_value: newValue });
      }
    }
  }
  return changes;
}

export const PRICE_LABELS: Record<string, string> = {
  purchase_price: "Prix d'achat", sale_price: "Détail pièce", wholesale_price: "Gros pièce",
  semi_wholesale_price: "Semi-gros pièce", packaging_sale_price: "Conditionnement principal",
  wholesale_packaging_price: "Conditionnement principal gros", supplier_purchase_price: "Prix fournisseur",
  price_detail: "Détail", price_semi_gros: "Semi-gros", price_gros: "Gros",
};
