import type { Product, SaleItem, UnitSpec } from "../types";
export type { UnitSpec } from "../types";
export type QuantitySpec = Pick<UnitSpec, "base_unit" | "packaging_unit" | "units_per_packaging">;

export type UnitMode = "base" | "packaging" | "mixed";
export type PriceTier = "detail" | "semi_gros" | "gros" | "auto";

export function resolveTier(product: UnitSpec, tier: PriceTier, quantity: number): Exclude<PriceTier, "auto"> {
  if (tier !== "auto") return tier;
  if (product.wholesale_min_qty != null && quantity >= product.wholesale_min_qty) return "gros";
  if (product.semi_wholesale_min_qty != null && quantity >= product.semi_wholesale_min_qty) return "semi_gros";
  return "detail";
}

export function withPackaging(product: Product, packagingId?: number | null): Product {
  const packaging = product.packagings?.find((p) => p.id === packagingId && p.active);
  return packaging ? { ...product, packaging_unit: packaging.name, units_per_packaging: packaging.factor,
    packaging_sale_price: packaging.price_detail, semi_packaging_price: packaging.price_semi_gros,
    wholesale_packaging_price: packaging.price_gros, additional_packaging: true } : product;
}

export function catalogPrices(product: UnitSpec & { sale_price: number; wholesale_price?: number }, tier: PriceTier = "detail", quantity = 0) {
  tier = resolveTier(product, tier, quantity);
  const factor = product.units_per_packaging || 1;
  let piece = product.sale_price;
  let carton = product.packaging_sale_price ?? factor * piece;
  if (tier === "semi_gros") {
    piece = product.semi_wholesale_price ?? piece;
    carton = product.semi_packaging_price ?? factor * piece;
  } else if (tier === "gros") {
    const wholesale = (product.wholesale_price || 0) > 0;
    if (wholesale) piece = product.wholesale_price!;
    carton = product.wholesale_packaging_price ?? (wholesale || product.additional_packaging ? factor * piece : carton);
  }
  return { piece, carton };
}

export function catalogUnitPrice(product: UnitSpec & { sale_price: number; wholesale_price?: number }, quantity: number, tier: PriceTier, parts: { packaging_quantity: number; piece_quantity: number }) {
  const { piece, carton } = catalogPrices(product, tier, quantity);
  return quantity ? (parts.packaging_quantity * carton + parts.piece_quantity * piece) / quantity : piece;
}

export function splitQuantity(product: QuantitySpec, quantity: number, mode: UnitMode = "mixed") {
  const factor = product.units_per_packaging || 1;
  const packs = product.packaging_unit && mode !== "base" ? Math.floor(quantity / factor) : 0;
  return { packaging_quantity: packs, piece_quantity: quantity - packs * factor };
}

export function saleUnitPrice(product: UnitSpec, quantity: number, basePrice: number, mode: UnitMode = "base", parts?: { packaging_quantity: number; piece_quantity: number }) {
  if (!quantity || !product.packaging_unit || mode === "base") return basePrice;
  const { packaging_quantity, piece_quantity } = parts ?? splitQuantity(product, quantity, mode);
  const packagingPrice = product.packaging_sale_price ?? basePrice * (product.units_per_packaging || 1);
  return (packaging_quantity * packagingPrice + piece_quantity * basePrice) / quantity;
}

export function formatQuantity(product: QuantitySpec, quantity: number) {
  const unit = product.base_unit || "pièce";
  const label = `${quantity} ${unit}`;
  if (!product.packaging_unit) return label;
  const parts = splitQuantity(product, Math.abs(quantity));
  return `${label} = ${quantity < 0 ? "−" : ""}${parts.packaging_quantity} ${product.packaging_unit}${parts.piece_quantity ? ` ${quantity < 0 ? "−" : "+"} ${parts.piece_quantity} ${unit}` : ""}`;
}

export function escapeUnitText(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function quantityHtml(product: QuantitySpec, quantity: number) {
    return escapeUnitText(formatQuantity(product, quantity));
}

export function salePriceParts(item: Pick<SaleItem, "unit_price" | "packaging_quantity" | "piece_quantity" | "packaging_sale_price" | "base_unit_price" | "packaging_unit" | "base_unit">) {
  if ((item.packaging_quantity || 0) > 0 && item.packaging_sale_price != null) {
    const parts = [{ kind: "packaging", amount: item.packaging_sale_price, unit: item.packaging_unit || "conditionnement" }];
    if (item.piece_quantity) parts.push({ kind: "base", amount: item.base_unit_price ?? item.unit_price, unit: item.base_unit || "pièce" });
    return parts;
  }
  return [{ kind: "base", amount: item.unit_price, unit: "" }];
}
