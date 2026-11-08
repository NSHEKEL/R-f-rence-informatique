import type { SaleItem, UnitSpec } from "../types";
export type { UnitSpec } from "../types";
export type QuantitySpec = Pick<UnitSpec, "base_unit" | "packaging_unit" | "units_per_packaging">;

export type UnitMode = "base" | "packaging" | "mixed";
export type PriceTier = "detail" | "gros";

export function catalogPrices(product: UnitSpec & { sale_price: number; wholesale_price?: number }, tier: PriceTier = "detail") {
  const factor = product.units_per_packaging || 1;
  let piece = product.sale_price;
  let carton = product.packaging_sale_price ?? factor * piece;
  if (tier === "gros") {
    const wholesale = (product.wholesale_price || 0) > 0;
    if (wholesale) piece = product.wholesale_price!;
    carton = product.wholesale_packaging_price ?? (wholesale ? factor * piece : carton);
  }
  return { piece, carton };
}

export function catalogUnitPrice(product: UnitSpec & { sale_price: number; wholesale_price?: number }, quantity: number, tier: PriceTier, parts: { packaging_quantity: number; piece_quantity: number }) {
  const { piece, carton } = catalogPrices(product, tier);
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
