import type { Product } from "../types";

/** Code carried by the label: barcode first, then the QR code, else the SKU. */
export function scanCode(product: Product): string {
  return product.barcode?.trim() || product.qr_code?.trim() || product.sku;
}

/** Every code a scanner may send for this article. */
export function scanCodes(product: Product): string[] {
  return [product.barcode, product.qr_code, product.sku]
    .map((code) => (code || "").trim().toLowerCase())
    .filter(Boolean);
}
