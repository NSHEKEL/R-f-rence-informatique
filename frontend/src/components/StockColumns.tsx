import { formatDate, formatXOF } from "../api/client";
import type { Product } from "../types";
import { packagingStock, type StockColumn } from "../lib/stockColumns";
import type { useStockColumns } from "../lib/useStockColumns";
export function StockColumnChooser({ config, disabled = false }: { config: ReturnType<typeof useStockColumns>; disabled?: boolean }) {
  return <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">Colonnes du tableau</summary><div className="mt-2 flex flex-wrap gap-4">{config.columns.map((column) => <label key={column.key} className="text-sm"><input type="checkbox" disabled={disabled} checked={config.show(column.key)} onChange={(event) => config.toggle(column.key, event.target.checked)} /> {column.label}</label>)}</div></details>;
}
const extras = (columns: StockColumn[]) => columns.filter((column) => !["article", "quantity"].includes(column.key));
export function StockExtraHeaders({ columns }: { columns: StockColumn[] }) { return <>{extras(columns).map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-2">{column.label}</th>)}</>; }
export function StockExtraCells({ product, columns }: { product: Product; columns: StockColumn[] }) {
  return <>{extras(columns).map((column) => <td className="whitespace-nowrap px-3 py-2" key={column.key}>{column.key.startsWith("pack:") ? packagingStock(product, column.key.slice(5)) : column.key === "reference" ? <>{product.sku}{product.barcode && <small className="block">{product.barcode}</small>}</> : column.key === "purchase" ? product.stock_purchase_price == null ? "—" : formatXOF(product.stock_purchase_price) : column.key === "value" ? product.stock_value == null ? "—" : formatXOF(product.stock_value) : product.nearest_expiry ? formatDate(product.nearest_expiry) : "—"}</td>)}</>;
}
