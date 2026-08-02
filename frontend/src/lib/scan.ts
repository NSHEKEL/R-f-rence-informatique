import type { Product } from "../types";

/** Code carried by the label: the one typed by the shop, else the SKU. */
export function scanCode(product: Product): string {
  return product.qr_code?.trim() || product.sku;
}
