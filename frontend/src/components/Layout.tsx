import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  Tags,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
} from "lucide-react";
import logo from "../assets/logo.jpg";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/produits", label: "Produits & Stock", icon: Package },
  { to: "/ventes", label: "Ventes", icon: ShoppingCart },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/fournisseurs", label: "Fournisseurs", icon: Truck },
  { to: "/categories", label: "Catégories", icon: Tags },
  { to: "/parametres", label: "Paramètres", icon: Settings },
];

const pageTitles: Record<string, string> = {
  "/": "Tableau de bord",
  "/produits": "Produits & Stock",
  "/ventes": "Ventes",
  "/clients": "Clients",
  "/fournisseurs": "Fournisseurs",
  "/categories": "Catégories",
  "/parametres": "Paramètres",
};

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Référence Informatique";

  const initials = (user?.name ?? "AD")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-100">
            <img src={logo} alt="Logo" className="h-11 w-11 object-contain" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-extrabold tracking-tight text-brand-700">
              RÉFÉRENCE
            </p>
            <p className="text-xs font-semibold tracking-widest text-slate-500">
              INFORMATIQUE
            </p>
          </div>
          <button
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {user?.name ?? "Administrateur"}
              </p>
              <p className="truncate text-xs capitalize text-slate-500">
                {user?.role ?? "admin"}
              </p>
            </div>
            <button
              onClick={logout}
              title="Se déconnecter"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-4 border-b border-slate-200 bg-white/80 px-5 py-4 backdrop-blur">
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={22} />
          </button>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 md:flex">
              <Search size={16} className="text-slate-400" />
              <input
                placeholder="Rechercher..."
                className="w-40 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <button className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-100">
              <Bell size={18} />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-500" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5 lg:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
