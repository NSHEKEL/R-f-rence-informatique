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
}

export interface InventoryHeader {
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

export function inventoryTable(report: InventoryReport) {
  const headers = ["Référence", "Désignation", "Rayon", "Emplacement", ...(report.theoretical_visible ? ["Stock théorique", "Quantité physique", "Écart +/-", "Prix achat unitaire", "Valeur théorique", "Valeur physique", "Valeur écart"] : ["Quantité physique"]), "Statut", "Note"];
  const rows = report.rows.map((row) => [row.sku, row.name, row.rayon || "", row.emplacement || "", ...(report.theoretical_visible ? [row.theoretical_qty ?? "", row.physical_qty ?? "", row.variance ?? "", row.unit_cost ?? "", row.theoretical_value ?? "", row.physical_value ?? "", row.variance_value ?? ""] : [row.physical_qty ?? ""]), row.status === "excedent" ? "excédent" : row.status, row.note]);
  return { headers, rows };
}

export function reportHtml(title: string, headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `<h1>${escape(title)}</h1><table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
