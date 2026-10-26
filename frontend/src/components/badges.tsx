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

const FNE_BADGES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  submitted: "bg-amber-100 text-amber-700",
  certified: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-600",
  error: "bg-red-100 text-red-600",
};

const FNE_LABELS: Record<string, string> = {
  pending: "En attente",
  submitted: "Transmise à la DGI",
  certified: "Normalisée",
  rejected: "Rejetée",
  error: "Erreur réseau",
};

export function fneBadge(status: string) {
  return (
    <span
      className={`badge ${FNE_BADGES[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {FNE_LABELS[status] ?? status}
    </span>
  );
}
