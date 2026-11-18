import type { Product } from "../types";

export interface StockColumn { key: string; label: string }
export type StockPreferences = Record<string, boolean>;
export const stockColumnKey = (user: number | undefined, view: string) => `easygest_stock_columns:${user ?? "anonymous"}:${view}`;
export function readStockColumns(key: string): StockPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === "boolean")) as StockPreferences : {};
  } catch { return {}; }
}
const normalized = (name: string) => name.trim().toLocaleLowerCase("fr");
export function productPackagings(product: Product) {
  return [{ name: product.packaging_unit || "", factor: product.units_per_packaging || 1 }, ...(product.packagings || []).filter((pack) => pack.active).map((pack) => ({ name: pack.name, factor: pack.factor }))].filter((pack) => pack.name.trim() && Number.isInteger(pack.factor) && pack.factor > 0);
}
export function stockColumns(products: Product[], cost: boolean, blind = false): StockColumn[] {
  const names = new Map<string, string>();
  for (const product of products) for (const pack of productPackagings(product)) if (!names.has(normalized(pack.name))) names.set(normalized(pack.name), pack.name.trim());
  return [{ key: "article", label: "Article" }, { key: "reference", label: "Référence" },
    ...(!blind ? [{ key: "quantity", label: "Qté pièces (base)" }, ...Array.from(names, ([key, label]) => ({ key: `pack:${key}`, label }))] : []),
    ...(cost ? [{ key: "purchase", label: "Prix d'achat" }, ...(!blind ? [{ key: "value", label: "Valeur stock" }] : [])] : []),
    { key: "expiry", label: "Date de péremption" }];
}
export function packagingStock(product: Product, name: string): string {
  if (product.quantity == null) return "";
  const factors = [...new Set(productPackagings(product).filter((pack) => normalized(pack.name) === name).map((pack) => pack.factor))];
  return factors.map((factor) => {
    const qty = product.quantity!;
    const remainder = qty % factor;
    return `${Math.trunc(qty / factor)}${remainder ? ` ${remainder < 0 ? "−" : "+"} ${Math.abs(remainder)} ${product.base_unit || "pcs"}` : ""}${factors.length > 1 ? ` (×${factor})` : ""}`;
  }).join(" / ");
}
