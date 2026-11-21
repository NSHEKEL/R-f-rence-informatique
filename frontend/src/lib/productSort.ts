type SortField = "created" | "name" | "code" | "quantity" | "purchase" | "sale" | "expiry";
export type ProductSort = "default" | `${SortField}_asc` | `${SortField}_desc`;
export type ProductStockFilter = "all" | "available" | "empty" | "low" | "sufficient" | "soon" | "expired";
type SortableProduct = { id: number; name: string; created_at?: string | null; sku?: string; barcode?: string; quantity?: number | null; min_stock?: number | null; stock_purchase_price?: number | null; sale_price?: number; nearest_expiry?: string | null };

const storageKey = "ri_products_sort";
const options: ProductSort[] = ["default", ...(["created", "name", "code", "quantity", "purchase", "sale", "expiry"] as const).flatMap((field) => [`${field}_asc`, `${field}_desc`] as ProductSort[])];
const frenchNames = new Intl.Collator("fr", { sensitivity: "base" });

export function readProductSort(): ProductSort {
  try {
    const value = localStorage.getItem(storageKey) as ProductSort;
    return options.includes(value) ? value : "default";
  } catch { return "default"; }
}

export function saveProductSort(value: ProductSort) {
  try { localStorage.setItem(storageKey, value); } catch { /* session-only preference */ }
}

export function matchesStock(product: SortableProduct, filter: ProductStockFilter, today = new Date()): boolean {
  if (filter === "all") return true;
  if (filter === "soon" || filter === "expired") {
    if (!product.nearest_expiry) return false;
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(now); end.setDate(end.getDate() + 30);
    const expiry = new Date(product.nearest_expiry.slice(0, 10) + "T00:00:00");
    return filter === "expired" ? expiry < now : expiry >= now && expiry <= end;
  }
  const quantity = product.quantity;
  if (quantity == null) return false;
  if (filter === "available") return quantity > 0;
  if (filter === "empty") return quantity <= 0;
  if (product.min_stock == null) return false;
  return filter === "low" ? quantity > 0 && quantity <= product.min_stock : quantity > product.min_stock;
}

export function sortProducts<T extends SortableProduct>(products: T[], sort: ProductSort): T[] {
  const sorted = [...products];
  if (sort === "default") return sorted;
  const direction = sort.endsWith("_desc") ? -1 : 1;
  const created = (product: T) => {
    const value = Date.parse(product.created_at || "");
    return Number.isFinite(value) ? value : 0;
  };
  const field = sort.slice(0, sort.lastIndexOf("_"));
  const value = (p: T): number | string | null | undefined => {
    switch (field) {
      case "name": return p.name;
      case "code": return p.sku || p.barcode || "";
      case "quantity": return p.quantity;
      case "purchase": return p.stock_purchase_price;
      case "sale": return p.sale_price;
      case "expiry": return p.nearest_expiry || null;
      default: return created(p);
    }
  };
  return sorted.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null || bv == null) return av == null ? bv == null ? a.id - b.id : 1 : -1;
    return direction * (typeof av === "string" && typeof bv === "string" ? frenchNames.compare(av, bv) : Number(av) - Number(bv) || a.id - b.id);
  });
}
