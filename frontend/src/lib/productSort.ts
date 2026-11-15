export type ProductSort = "default" | "created_asc" | "created_desc" | "name_asc" | "name_desc";

const storageKey = "ri_products_sort";
const options: ProductSort[] = ["default", "created_asc", "created_desc", "name_asc", "name_desc"];
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

export function sortProducts<T extends { id: number; name: string; created_at?: string | null }>(products: T[], sort: ProductSort): T[] {
  const sorted = [...products];
  if (sort === "default") return sorted;
  const direction = sort.endsWith("_desc") ? -1 : 1;
  const created = (product: T) => {
    const value = Date.parse(product.created_at || "");
    return Number.isFinite(value) ? value : 0;
  };
  return sorted.sort((a, b) => direction * (sort.startsWith("name_")
    ? frenchNames.compare(a.name, b.name)
    : created(a) - created(b) || a.id - b.id));
}
