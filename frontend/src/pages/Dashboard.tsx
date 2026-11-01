import { useCallback, useEffect, useState } from "react";
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
  ArrowRight,
  Boxes,
  Package,
  PackagePlus,
  PackageCheck,
  ShoppingCart,
  TrendingUp,
  Users,
  UserPlus,
  AlertTriangle,
  Award,
  CalendarRange,
  Wallet,
  Plus,
  FileText,
  ClipboardCheck,
  ClipboardList,
  HandCoins,
  BarChart3,
  Calculator,
  Truck,
  EyeOff,
  SlidersHorizontal,
  Clock,
} from "lucide-react";
import api, { formatDate, formatXOF } from "../api/client";
import type { DashboardStats } from "../types";
import { statusBadge } from "../components/badges";
import { useAuth } from "../context/AuthContext";
import { useLicense } from "../context/LicenseContext";
import { useSyncVersion } from "../context/SyncContext";
import { TILL_GATED, useTill } from "../context/TillContext";
import { ADMIN_FEATURE, PLAN_FEATURE } from "../lib/planFeatures";
import { RECENTS_KEY } from "../components/Layout";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const RANGES: { label: string; days: number | "year" }[] = [
  { label: "7 jours", days: 7 },
  { label: "30 jours", days: 30 },
  { label: "90 jours", days: 90 },
  { label: "Année", days: "year" },
];

type Tile = {
  to: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  tint: string;
  access: string;
};

/** One-tap actions shown on the home grid; each points at a real module. */
const QUICK_TILES: Tile[] = [
  {
    to: "/ventes/nouvelle",
    label: "Nouvelle vente",
    desc: "Ouvrir le ticket de caisse",
    icon: Plus,
    tint: "bg-brand-50 text-brand-600",
    access: "vente_nouvelle",
  },
  {
    to: "/produits",
    label: "Nouvel article",
    desc: "Ajouter au catalogue",
    icon: PackagePlus,
    tint: "bg-violet-50 text-violet-600",
    access: "produits",
  },
  {
    to: "/clients",
    label: "Nouveau client",
    desc: "Créer une fiche client",
    icon: UserPlus,
    tint: "bg-emerald-50 text-emerald-600",
    access: "clients",
  },
  {
    to: "/ventes",
    label: "Ventes & factures",
    desc: "Historique et impressions",
    icon: ShoppingCart,
    tint: "bg-sky-50 text-sky-600",
    access: "ventes",
  },
  {
    to: "/proformas",
    label: "Devis & proforma",
    desc: "Créer un document client",
    icon: FileText,
    tint: "bg-amber-50 text-amber-600",
    access: "proformas",
  },
  {
    to: "/commandes",
    label: "Commandes",
    desc: "Suivre les commandes clients",
    icon: ClipboardCheck,
    tint: "bg-indigo-50 text-indigo-600",
    access: "commandes",
  },
  {
    to: "/approvisionnements",
    label: "Nouvel achat",
    desc: "Commande fournisseur",
    icon: Truck,
    tint: "bg-orange-50 text-orange-600",
    access: "approvisionnements",
  },
  {
    to: "/livraisons",
    label: "Réception",
    desc: "Bons de livraison",
    icon: PackageCheck,
    tint: "bg-teal-50 text-teal-600",
    access: "livraisons",
  },
  {
    to: "/inventaire",
    label: "Inventaire",
    desc: "Compter et ajuster le stock",
    icon: ClipboardList,
    tint: "bg-rose-50 text-rose-600",
    access: "inventaire",
  },
  {
    to: "/comptabilite",
    label: "Dépense",
    desc: "Enregistrer une sortie",
    icon: Calculator,
    tint: "bg-red-50 text-red-600",
    access: "comptabilite",
  },
  {
    to: "/dettes",
    label: "Encaissement",
    desc: "Règlement d'une créance",
    icon: HandCoins,
    tint: "bg-green-50 text-green-600",
    access: "dettes",
  },
  {
    to: "/rapports",
    label: "Rapports",
    desc: "Exports et analyses",
    icon: BarChart3,
    tint: "bg-fuchsia-50 text-fuchsia-600",
    access: "rapports",
  },
];

/** Big module cards under the quick actions. */
const MODULES: Tile[] = [
  {
    to: "/ventes",
    label: "VENTES",
    desc: "Ventes, factures, devis et livraisons",
    icon: ShoppingCart,
    tint: "bg-brand-600",
    access: "ventes",
  },
  {
    to: "/produits",
    label: "STOCKS",
    desc: "Articles, lots, mouvements, inventaires",
    icon: Package,
    tint: "bg-violet-600",
    access: "produits",
  },
  {
    to: "/approvisionnements",
    label: "ACHATS",
    desc: "Commandes et approvisionnements",
    icon: Truck,
    tint: "bg-orange-500",
    access: "approvisionnements",
  },
  {
    to: "/clients",
    label: "CLIENTS",
    desc: "Fiches, créances et historiques",
    icon: Users,
    tint: "bg-emerald-600",
    access: "clients",
  },
  {
    to: "/caisse",
    label: "TRÉSORERIE",
    desc: "Caisse, encaissements et versements",
    icon: Wallet,
    tint: "bg-teal-600",
    access: "caisse",
  },
  {
    to: "/comptabilite",
    label: "COMPTABILITÉ",
    desc: "Opérations, dépenses et états",
    icon: Calculator,
    tint: "bg-slate-600",
    access: "comptabilite",
  },
];

const HIDDEN_KEY = "ri_dash_hidden_tiles";

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
  const version = useSyncVersion();
  const { hasFeature } = useLicense();
  const { user, isAdmin, can } = useAuth();
  const { selling } = useTill();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [recents] = useState<{ to: string; label: string }[]>(() => {
    try {
      const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
      return Array.isArray(list) ? list.filter((r) => r.to !== "/") : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(() =>
    isoDay(new Date(new Date().getFullYear(), 0, 1))
  );
  const [end, setEnd] = useState(() => isoDay(new Date()));

  const load = useCallback(async () => {
    const res = await api.get<DashboardStats>("/dashboard", {
      params: { start, end },
    });
    setStats(res.data);
    setLoading(false);
  }, [start, end]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load, version]);

  /** Same three gates as the side menu: right, plan, open till. */
  function tileAccess(tile: Tile): { ok: boolean; locked: "till" | "plan" | null } {
    const allowed =
      tile.access === "admin" ? isAdmin : can(tile.access);
    if (!allowed) return { ok: false, locked: null };
    const feature = ADMIN_FEATURE[tile.to] ?? PLAN_FEATURE[tile.access];
    if (feature && !hasFeature(feature)) return { ok: true, locked: "plan" };
    if (TILL_GATED.has(tile.access) && !selling)
      return { ok: true, locked: "till" };
    return { ok: true, locked: null };
  }

  function tileTarget(tile: Tile): string {
    const { locked } = tileAccess(tile);
    if (locked === "till") return "/caisse";
    if (locked === "plan") return "/mon-abonnement";
    return tile.to;
  }

  function toggleHidden(to: string) {
    setHidden((prev) => {
      const next = prev.includes(to)
        ? prev.filter((t) => t !== to)
        : [...prev, to];
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      return next;
    });
  }

  const visibleTiles = QUICK_TILES.filter(
    (t) => tileAccess(t).ok && (personalizing || !hidden.includes(t.to))
  );
  const visibleModules = MODULES.filter((t) => tileAccess(t).ok);

  function applyRange(days: number | "year") {
    const today = new Date();
    setEnd(isoDay(today));
    if (days === "year") {
      setStart(isoDay(new Date(today.getFullYear(), 0, 1)));
      return;
    }
    const from = new Date(today);
    from.setDate(from.getDate() - (days - 1));
    setStart(isoDay(from));
  }

  if (loading || !stats) {
    return <div className="text-slate-500">Chargement du tableau de bord...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Welcome hero, like the reference ERP home. */}
      <div className="card overflow-hidden p-0">
        <div className="flex flex-col gap-2 bg-gradient-to-r from-brand-700 to-brand-500 px-6 py-5 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">
              Bonjour, bienvenue sur EasyGest !
            </h2>
            <p className="text-sm text-brand-100">
              Voici l'activité de votre boutique
              {user?.name ? `, ${user.name}` : ""}.
            </p>
          </div>
          <div className="sm:ml-auto sm:text-right">
            <p className="text-xs font-medium uppercase tracking-widest text-brand-200">
              Aujourd'hui
            </p>
            <p className="text-sm font-semibold capitalize">
              {new Date().toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {recents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Clock size={13} /> Récemment utilisés
          </span>
          {recents.map((r) => (
            <Link
              key={r.to}
              to={r.to}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <CalendarRange size={18} className="text-brand-600" /> Période
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Du</label>
            <input
              type="date"
              className="input w-auto"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Au</label>
            <input
              type="date"
              className="input w-auto"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {RANGES.map((r) => (
            <button
              key={r.label}
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => applyRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
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
        <StatCard
          title="Écarts de caisse"
          value={
            (stats.cash_gap_count ?? 0) === 0
              ? "Aucun"
              : `${stats.cash_gap_count} (${formatXOF(stats.cash_gap_total ?? 0)})`
          }
          icon={Wallet}
          tint={
            (stats.cash_gap_count ?? 0) === 0
              ? "bg-slate-50 text-slate-500"
              : "bg-red-50 text-red-600"
          }
        />
      </div>

      {/* Quick actions as coloured tiles, like the reference ERP. */}
      {visibleTiles.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Accès rapides
            </h2>
            {isAdmin && (
              <button
                onClick={() => setPersonalizing((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  personalizing
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <SlidersHorizontal size={14} />
                {personalizing ? "Terminer" : "Personnaliser"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {visibleTiles.map((tile) => {
              const { locked } = tileAccess(tile);
              const isHidden = hidden.includes(tile.to);
              return (
                <div key={tile.to} className="relative">
                  <Link
                    to={tileTarget(tile)}
                    className={`card group flex h-full flex-col p-4 transition-shadow hover:shadow-md ${
                      isHidden ? "opacity-40" : ""
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${tile.tint}`}
                    >
                      <tile.icon size={20} />
                    </div>
                    <p className="mt-3 text-sm font-bold text-slate-800">
                      {tile.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{tile.desc}</p>
                    {locked && (
                      <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        🔒 {locked === "till" ? "Caisse fermée" : "Hors formule"}
                      </span>
                    )}
                  </Link>
                  {personalizing && (
                    <button
                      onClick={() => toggleHidden(tile.to)}
                      title={isHidden ? "Réafficher" : "Masquer"}
                      aria-label={`${isHidden ? "Réafficher" : "Masquer"} ${tile.label}`}
                      className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-brand-600"
                    >
                      <EyeOff size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Big module cards. */}
      {visibleModules.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((mod) => (
            <Link
              key={mod.to}
              to={tileTarget(mod)}
              className="card group flex items-center gap-4 p-5 transition-shadow hover:shadow-md"
            >
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white ${mod.tint}`}
              >
                <mod.icon size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold tracking-wide text-slate-800">
                  {mod.label}
                </p>
                <p className="truncate text-xs text-slate-400">{mod.desc}</p>
              </div>
              <ArrowRight
                size={18}
                className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500"
              />
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {hasFeature("statistiques") && (
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
        )}

        {/* Widgets in a grid: side by side on a wide screen, stacked in the
            right-hand column when the chart is displayed. */}
        <div
          className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${
            hasFeature("statistiques")
              ? "xl:grid-cols-1"
              : "xl:col-span-3 xl:grid-cols-3"
          }`}
        >
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
              <Award size={18} className="text-amber-500" />
              <h2 className="text-lg font-bold text-slate-900">
                Meilleures vendeuses
              </h2>
            </div>
            {stats.top_sellers.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucune vente sur la période.
              </p>
            ) : (
              <ul className="space-y-3">
                {stats.top_sellers.map((s, i) => (
                  <li key={s.name} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        i === 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {s.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {s.sales_count} vente(s)
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-700">
                      {formatXOF(s.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
