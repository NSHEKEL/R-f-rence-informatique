import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Building2, ClipboardList, LayoutGrid, LogOut } from "lucide-react";
import central, {
  getCentralToken,
  getCentralUrl,
  setCentralToken,
} from "../../api/central";

const entries = [
  { to: "/console", label: "Tableau de bord", icon: BarChart3, end: true },
  { to: "/console/clients", label: "Mes clients", icon: Building2 },
  { to: "/console/formules", label: "Formules & Droits", icon: LayoutGrid },
  { to: "/console/journal", label: "Journal", icon: ClipboardList },
];

/** Frame of the console: only the Global Administrator gets past it. */
export default function ConsoleLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [admin, setAdmin] = useState<{ name: string; email: string } | null>(
    null
  );

  useEffect(() => {
    if (!getCentralToken()) return;
    central
      .get<{ name: string; email: string }>("/auth/me")
      .then((res) => setAdmin(res.data))
      .catch(() => setAdmin(null));
  }, []);

  if (!getCentralToken()) return <Navigate to="/console/connexion" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <aside className="flex w-64 flex-col bg-slate-900 text-slate-200">
        <div className="px-5 py-6">
          <p className="text-sm font-extrabold uppercase tracking-tight text-white">
            EasyGest
          </p>
          <p className="text-[11px] tracking-widest text-slate-400">
            ADMINISTRATEUR GLOBAL
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {entries.map((entry) => {
            const active = entry.end
              ? location.pathname === entry.to
              : location.pathname.startsWith(entry.to);
            return (
              <button
                key={entry.to}
                type="button"
                onClick={() => navigate(entry.to)}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium ${
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                <entry.icon size={18} />
                {entry.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <p className="truncate font-semibold text-slate-200">
            {admin?.name ?? "Administrateur"}
          </p>
          <p className="truncate">{admin?.email ?? ""}</p>
          <p className="mt-1 truncate">{getCentralUrl() || "ce serveur"}</p>
          <button
            type="button"
            onClick={() => {
              setCentralToken("");
              navigate("/console/connexion");
            }}
            className="mt-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-slate-800"
          >
            <LogOut size={16} /> Se déconnecter
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
