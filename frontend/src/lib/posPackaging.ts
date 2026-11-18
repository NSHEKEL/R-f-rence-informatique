import type { Product } from "../types";
import { withPackaging, type PriceTier } from "./units";

export function packagingChoices(product: Product) {
  return [{ key: "base", label: product.base_unit || "Pièce" },
    ...(product.packaging_unit ? [{ key: "primary", label: product.packaging_unit }] : []),
    ...(product.packagings || []).filter((p) => p.active).map((p) => ({ key: String(p.id), label: p.name }))];
}

export function switchPackaging(product: Product, key: string, tier: PriceTier) {
  const packaging_id = key === "base" || key === "primary" ? undefined : Number(key);
  const selected = withPackaging(product, packaging_id);
  const unitMode = key === "base" ? "base" as const : "packaging" as const;
  return { product: selected, packaging_id, unitMode, quantity: unitMode === "base" ? 1 : selected.units_per_packaging || 1,
    price_tier: tier, price: undefined, packagingQuantity: undefined, pieceQuantity: undefined };
}
