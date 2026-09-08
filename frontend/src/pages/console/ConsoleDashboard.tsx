import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import central, { centralError, type Dashboard } from "../../api/central";

const PLAN_COLOURS = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

function Card({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${tone || "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

export default function ConsoleDashboard() {
  const [stats, setStats] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    central
      .get<Dashboard>("/dashboard")
      .then((res) => setStats(res.data))
      .catch((err) =>
        setError(centralError(err, "Tableau de bord indisponible"))
      );
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!stats) return <p className="text-sm text-slate-500">Chargement...</p>;

  const perPlan = Object.entries(stats.per_plan).map(([name, clients]) => ({
    name,
    clients,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Tableau de bord</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Clients" value={stats.clients} />
        <Card label="Licences actives" value={stats.active} tone="text-emerald-600" />
        <Card label="Suspendues" value={stats.suspended} tone="text-amber-600" />
        <Card label="Expirées" value={stats.expired} tone="text-slate-600" />
        <Card
          label="Bientôt expirées"
          value={stats.expiring_soon}
          tone="text-orange-600"
        />
        <Card label="Révoquées" value={stats.revoked} tone="text-red-600" />
        <Card label="Connectés" value={stats.online} tone="text-sky-600" />
        <Card label="Hors ligne" value={stats.offline} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Clients par formule
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={perPlan}
                  dataKey="clients"
                  nameKey="name"
                  outerRadius={90}
                  label
                >
                  {perPlan.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={PLAN_COLOURS[index % PLAN_COLOURS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Nouveaux clients par mois
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.signups}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="clients" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
