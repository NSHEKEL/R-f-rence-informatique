import type { ProductBarcode, ProductPackaging } from "../types";

export function purchaseFactor(form: { packaging_unit: string; units_per_packaging: number; packagings: ProductPackaging[] }): number | null {
  if (form.packaging_unit.trim()) return form.units_per_packaging > 0 ? form.units_per_packaging : null;
  return [...form.packagings].filter((row) => row.active).sort((a, b) => a.sort_order - b.sort_order)[0]?.factor || null;
}

export function piecePurchasePrice(packagingTotal: number | "", factor: number | null): number | null {
  return packagingTotal !== "" && Number.isFinite(packagingTotal) && packagingTotal > 0 && factor !== null && Number.isFinite(factor) && factor > 0
    ? Math.round(packagingTotal / factor) : null;
}

export function followPurchasePrice(current: number, calculated: number | null, manual: boolean): number {
  return manual || calculated === null ? current : calculated;
}

export function productBarcodes(rows: ProductBarcode[]): ProductBarcode[] {
  return rows.filter((row) => row.id || row.code.trim()).map((row) => ({ ...row, code: row.code.trim() }));
}

export function productTextError(form: {
  base_unit: string;
  packaging_unit: string;
  rayon?: string | null;
  emplacement?: string | null;
  packagings: Pick<ProductPackaging, "name">[];
  barcodes: Pick<ProductBarcode, "code" | "label">[];
}): string {
  const checks: [string, string, number][] = [
    ["Unité de base", form.base_unit.trim(), 40],
    ["Conditionnement principal", form.packaging_unit.trim(), 40],
    ["Rayon", form.rayon ?? "", 200],
    ["Emplacement", form.emplacement ?? "", 200],
  ];
  form.packagings.forEach((row, index) => checks.push([`Conditionnement ${index + 1} · Nom`, row.name, 80]));
  form.barcodes.forEach((row, index) => checks.push(
    [`Code-barres ${index + 1}`, row.code, 200],
    [`Code-barres ${index + 1} · Libellé`, row.label ?? "", 200],
  ));
  const invalid = checks.find(([, value, max]) => Array.from(value).length > max);
  return invalid ? `${invalid[0]} : ${invalid[2]} caractères maximum.` : "";
}
