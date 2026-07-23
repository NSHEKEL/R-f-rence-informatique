import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  AlertTriangle,
} from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { DashboardStats } from "../types";
import { statusBadge } from "../components/badges";

function StatCard({
  title,
  value,
  change,
  icon: Icon,
  tint,
}: {
  title: string;
  value: string;
  change?: number;
  icon: React.ElementType;
  tint: string;
}) {
  const positive = (change ?? 0) >= 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${tint}`}>
          <Icon size={22} />
        </div>
        {change !== undefined && (
          <span
            className={`badge ${
              positive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            }`}
          >
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="mt-4 text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
        {value}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardStats>("/dashboard")
      .then((res) => setStats(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) {
    return <div className="text-slate-500">Chargement du tableau de bord...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Chiffre d'affaires"
          value={formatXOF(stats.total_revenue)}
          change={stats.revenue_change}
          icon={TrendingUp}
          tint="bg-brand-50 text-brand-600"
        />
        <StatCard
          title="Ventes"
          value={String(stats.total_sales)}
          change={stats.sales_change}
          icon={ShoppingCart}
          tint="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          title="Produits en catalogue"
          value={String(stats.total_products)}
          icon={Package}
          tint="bg-violet-50 text-violet-600"
        />
        <StatCard
          title="Clients"
          value={String(stats.total_customers)}
          icon={Users}
          tint="bg-amber-50 text-amber-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Revenus mensuels
              </h2>
              <p className="text-sm text-slate-500">Évolution du chiffre d'affaires</p>
            </div>
            <span className="badge bg-brand-50 text-brand-700">
              Valeur du stock : {formatXOF(stats.total_stock_value)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={stats.monthly_revenue} margin={{ left: 8, right: 8 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1b6fe3" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1b6fe3" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                width={40}
              />
              <Tooltip
                formatter={(v) => [formatXOF(Number(v)), "Revenus"]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#1b6fe3"
                strokeWidth={2.5}
                fill="url(#rev)"
                dot={{ r: 3, fill: "#1b6fe3" }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              <h2 className="text-lg font-bold text-slate-900">Stock faible</h2>
              <span className="badge ml-auto bg-amber-50 text-amber-600">
                {stats.low_stock_count}
              </span>
            </div>
            {stats.low_stock_products.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune alerte de stock.</p>
            ) : (
              <ul className="space-y-3">
                {stats.low_stock_products.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">{p.sku}</p>
                    </div>
                    <span className="badge shrink-0 bg-red-50 text-red-600">
                      {p.quantity} / {p.min_stock}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/produits"
              className="mt-4 block text-center text-sm font-semibold text-brand-600 hover:underline"
            >
              Gérer le stock
            </Link>
          </div>

          <div className="card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Boxes size={18} className="text-brand-500" />
              <h2 className="text-lg font-bold text-slate-900">Top produits</h2>
            </div>
            {stats.top_products.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune vente enregistrée.</p>
            ) : (
              <ul className="space-y-3">
                {stats.top_products.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400">{p.quantity} vendus</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-700">
                      {formatXOF(p.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-lg font-bold text-slate-900">Ventes récentes</h2>
          <Link
            to="/ventes"
            className="text-sm font-semibold text-brand-600 hover:underline"
          >
            Voir tout
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3">Référence</th>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Statut</th>
                <th className="px-6 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.recent_sales.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 font-semibold text-slate-800">
                    {s.reference}
                  </td>
                  <td className="px-6 py-3.5 text-slate-600">
                    {s.customer?.name ?? "Client de passage"}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(s.date)}</td>
                  <td className="px-6 py-3.5">{statusBadge(s.status)}</td>
                  <td className="px-6 py-3.5 text-right font-semibold text-slate-800">
                    {formatXOF(s.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
