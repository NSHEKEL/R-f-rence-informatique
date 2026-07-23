import type { Product } from "../types";

export function statusBadge(status: string) {
  const map: Record<string, string> = {
    Payée: "bg-emerald-50 text-emerald-600",
    "En attente": "bg-amber-50 text-amber-600",
    Annulée: "bg-red-50 text-red-600",
  };
  return (
    <span className={`badge ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

export function stockBadge(product: Product) {
  if (product.quantity <= 0) {
    return <span className="badge bg-red-50 text-red-600">Rupture</span>;
  }
  if (product.quantity <= product.min_stock) {
    return <span className="badge bg-amber-50 text-amber-600">Stock faible</span>;
  }
  return <span className="badge bg-emerald-50 text-emerald-600">En stock</span>;
}
