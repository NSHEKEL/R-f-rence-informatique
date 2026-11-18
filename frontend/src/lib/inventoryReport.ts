export interface InventoryRow {
  product_id: number;
  sku: string;
  name: string;
  rayon?: string | null;
  emplacement?: string | null;
  base_unit: string;
  packaging_unit: string;
  units_per_packaging: number;
  packagings: { id: number; name: string; factor: number; barcode?: string }[];
  physical_qty: number | null;
  theoretical_qty?: number;
  variance?: number | null;
  unit_cost?: number;
  theoretical_value?: number;
  physical_value?: number | null;
  variance_value?: number | null;
  status: string;
  note: string;
  counts?: Record<string, number | null>;
  client_updated_at?: string | null;
  client_id?: string;
  category?: string;
  supplier?: string;
  barcode?: string;
  qr_code?: string;
  barcodes?: string[];
}

export function inventoryScan(rows: InventoryRow[], code: string) {
  const needle = code.trim().toLowerCase();
  const row = rows.find((row) => [row.sku, row.barcode, row.qr_code, ...(row.barcodes || []), ...(row.packagings || []).map((pack) => pack.barcode)].some((value) => value && value.toLowerCase() === needle));
  if (!row) return null;
  const pack = row.packagings.find((pack) => pack.barcode?.toLowerCase() === needle);
  return { row, key: pack ? String(pack.id) : "base" };
}

export interface InventoryHeader {
  scope?: { depot_id?: number; depot_name?: string };
  id: number;
  reference: string;
  name: string;
  scope_type: string;
  blind: boolean;
  status: string;
  created_at: string;
  created_by_name: string;
  validated_at?: string | null;
  validated_by_name?: string | null;
  note: string;
}

export interface InventoryReport extends InventoryHeader {
  theoretical_visible: boolean;
  rows: InventoryRow[];
  stats: Record<string, number>;
}

export const INVENTORY_STATS: Record<string, string> = { counted: "Inventoriés", not_counted: "Non comptés", conforme: "Conformes", manquant: "Manquants", excedent: "Excédentaires", variance_value: "Valeur des écarts", theoretical_value: "Valeur théorique", physical_value: "Valeur physique comptée", stock_after_value: "Valeur du stock après inventaire" };

export function inventoryUnits(row: InventoryRow) {
  return [
    ...(row.packaging_unit ? [{ key: "primary", name: row.packaging_unit, factor: row.units_per_packaging }] : []),
    ...(row.packagings || []).map((pack) => ({ key: String(pack.id), name: pack.name, factor: pack.factor })),
    { key: "base", name: `Unité (${row.base_unit})`, factor: 1 },
  ];
}

export function inventoryTotal(counts: Record<string, number | null>, row: InventoryRow) {
  return Object.values(counts).some((value) => value !== null) ? inventoryUnits(row).reduce((total, unit) => total + (counts[unit.key] ?? 0) * unit.factor, 0) : null;
}

export function inventoryTable(report: InventoryReport) {
  const headers = ["Référence", "Désignation", "Rayon", "Emplacement", ...(report.theoretical_visible ? ["Stock théorique", "Quantité physique", "Écart +/-", "Prix achat unitaire", "Valeur théorique", "Valeur physique", "Valeur écart"] : ["Quantité physique"]), "Statut", "Note"];
  const rows = report.rows.map((row) => [row.sku, row.name, row.rayon || "", row.emplacement || "", ...(report.theoretical_visible ? [row.theoretical_qty ?? "", row.physical_qty ?? "", row.variance ?? "", row.unit_cost ?? "", row.theoretical_value ?? "", row.physical_value ?? "", row.variance_value ?? ""] : [row.physical_qty ?? ""]), row.status === "excedent" ? "excédent" : row.status, row.note]);
  headers.push("Détail du comptage");
  rows.forEach((values, index) => {
    const row = report.rows[index];
    values.push(inventoryUnits(row).filter((unit) => row.counts?.[unit.key] != null).map((unit) => `${row.counts![unit.key]} ${unit.name} ×${unit.factor}`).join(" + "));
  });
  return { headers, rows };
}

export function reportHtml(title: string, headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `<h1>${escape(title)}</h1><table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
