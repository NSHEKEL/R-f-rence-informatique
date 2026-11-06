import { useEffect, useState } from "react";
import api, { formatXOF } from "../api/client";
import { useSyncVersion } from "../context/SyncContext";

interface Expiring {
  quantity: number;
  value: number;
}

interface StockStats {
  quantity_total: number;
  references: number;
  cost_value: number;
  sale_value: number;
  out_of_stock: number;
  low_stock: number;
  expiring: { critical: Expiring; alert: Expiring; watch: Expiring };
  expired_quantity: number;
  expired_value: number;
  usable_value: number;
  loss_value: number;
  thresholds: { critical: number; alert: number; watch: number };
}

const money = (v: number) => formatXOF(v);

export default function StockDashboard({
  onShowExpired,
}: {
  onShowExpired: () => void;
}) {
  const version = useSyncVersion();
  const [stats, setStats] = useState<StockStats | null>(null);

  useEffect(() => {
    api
      .get<StockStats>("/products/stock/dashboard")
      .then((res) => setStats(res.data))
      .catch(() => setStats(null));
  }, [version]);

  if (!stats) return null;

  const cards: { label: string; value: string; tint?: string; onClick?: () => void }[] = [
    { label: "Quantité totale", value: String(stats.quantity_total) },
    { label: "Références", value: String(stats.references) },
    { label: "Valeur stock (coût)", value: money(stats.cost_value) },
    { label: "Valeur potentielle (vente)", value: money(stats.sale_value) },
    {
      label: "En rupture",
      value: String(stats.out_of_stock),
      tint: stats.out_of_stock ? "text-red-600" : undefined,
    },
    {
      label: "Sous le seuil",
      value: String(stats.low_stock),
      tint: stats.low_stock ? "text-amber-600" : undefined,
    },
    {
      label: `Expire ≤ ${stats.thresholds.critical} j`,
      value: `${stats.expiring.critical.quantity} u · ${money(stats.expiring.critical.value)}`,
      tint: stats.expiring.critical.quantity ? "text-red-600" : undefined,
    },
    {
      label: `Expire ≤ ${stats.thresholds.alert} j`,
      value: `${stats.expiring.alert.quantity} u · ${money(stats.expiring.alert.value)}`,
      tint: stats.expiring.alert.quantity ? "text-amber-600" : undefined,
    },
    {
      label: "Périmés",
      value: `${stats.expired_quantity} u · ${money(stats.expired_value)}`,
      tint: stats.expired_quantity ? "text-red-700" : undefined,
      onClick: onShowExpired,
    },
    { label: "Stock exploitable", value: money(stats.usable_value) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <button
          key={card.label}
          onClick={card.onClick}
          disabled={!card.onClick}
          className={`card px-4 py-3 text-left ${
            card.onClick ? "hover:border-brand-300 cursor-pointer" : ""
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {card.label}
          </p>
          <p className={`mt-1 text-base font-bold ${card.tint ?? "text-slate-900"}`}>
            {card.value}
          </p>
        </button>
      ))}
    </div>
  );
}
