import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  Tags,
  Settings,
  UserCog,
  LogOut,
  Menu,
  X,
  Calculator,
  ClipboardList,
  Wallet,
  Undo2,
  Plus,
  BarChart3,
  FileText,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardCheck,
  PackageCheck,
  PackagePlus,
  ShieldCheck,
  Lock,
  BadgeCheck,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useLicense } from "../context/LicenseContext";
import { TILL_GATED, useTill } from "../context/TillContext";
import { PLAN_FEATURE } from "../lib/planFeatures";
import { isFullscreen, toggleFullscreen } from "../lib/fullscreen";
import LicenseBanner from "./LicenseBanner";
import NetworkBanner from "./NetworkBanner";
import UpdateBanner from "./UpdateBanner";
import NotificationBell from "./NotificationBell";
import UndoRedo from "./UndoRedo";

/**
 * Right the entry needs; "admin" marks the pages the administrator never
 * shares (accounts, settings, access rights).
 */
const navItems: {
  to: string;
  label: string;
  icon: typeof Wallet;
  end?: boolean;
  access: string;
}[] = [
  {
    to: "/",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    end: true,
    access: "tableau_bord",
  },
  { to: "/caisse", label: "Ma caisse", icon: Wallet, access: "caisse" },
  {
    to: "/ventes/nouvelle",
    label: "Nouvelle vente",
    icon: Plus,
    access: "vente_nouvelle",
  },
  {
    to: "/ventes",
    label: "Ventes",
    icon: ShoppingCart,
    end: true,
    access: "ventes",
  },
  {
    to: "/commandes",
    label: "Commandes",
    icon: ClipboardCheck,
    access: "commandes",
  },
  {
    to: "/livraisons",
    label: "Livraisons",
    icon: PackageCheck,
    access: "livraisons",
  },
  { to: "/retours", label: "Retours & avoirs", icon: Undo2, access: "retours" },
  { to: "/clients", label: "Clients", icon: Users, access: "clients" },
  {
    to: "/produits",
    label: "Produits & Stock",
    icon: Package,
    access: "produits",
  },
  {
    to: "/inventaire",
    label: "Inventaire",
    icon: ClipboardList,
    access: "inventaire",
  },
  {
    to: "/rapports",
    label: "Rapports",
    icon: BarChart3,
    access: "rapports",
  },
  {
    to: "/proformas",
    label: "Factures proforma",
    icon: FileText,
    access: "proformas",
  },
  {
    to: "/comptabilite",
    label: "Comptabilité",
    icon: Calculator,
    access: "comptabilite",
  },
  {
    to: "/fournisseurs",
    label: "Fournisseurs",
    icon: Truck,
    access: "fournisseurs",
  },
  {
    to: "/approvisionnements",
    label: "Approvisionnement",
    icon: PackagePlus,
    access: "approvisionnements",
  },
  { to: "/categories", label: "Catégories", icon: Tags, access: "categories" },
  { to: "/utilisateurs", label: "Utilisateurs", icon: UserCog, access: "admin" },
  {
    to: "/droits",
    label: "Droits d'accès",
    icon: ShieldCheck,
    access: "admin",
  },
  { to: "/parametres", label: "Paramètres", icon: Settings, access: "admin" },
  {
    to: "/mon-abonnement",
    label: "Mon abonnement",
    icon: BadgeCheck,
    access: "",
  },
  { to: "/a-propos", label: "À propos de nous", icon: Info, access: "apropos" },
];

const COLLAPSED_KEY = "ri_sidebar_collapsed";

const roleLabels: Record<string, string> = {
  admin: "Administrateur",
  vendeur: "Vendeur",
  gestionnaire: "Gestionnaire de stock",
};

const pageTitles: Record<string, string> = {
  "/": "Tableau de bord",
  "/caisse": "Ma caisse",
  "/ventes/nouvelle": "Nouvelle vente",
  "/retours": "Retours & avoirs",
  "/produits": "Produits & Stock",
  "/inventaire": "Inventaire",
  "/rapports": "Rapports",
  "/proformas": "Factures proforma",
  "/comptabilite": "Comptabilité",
  "/ventes": "Ventes",
  "/commandes": "Commandes",
  "/livraisons": "Livraisons",
  "/clients": "Clients",
  "/fournisseurs": "Fournisseurs",
  "/approvisionnements": "Approvisionnement",
  "/categories": "Catégories",
  "/utilisateurs": "Utilisateurs",
  "/droits": "Droits d'accès",
  "/parametres": "Paramètres",
  "/mon-abonnement": "Mon abonnement",
  "/a-propos": "À propos de nous",
};

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1"
  );
  const { user, isAdmin, can, logout } = useAuth();
  const { brandName, logoSrc } = useCompany();
  const { hasFeature, featureName } = useLicense();
  const { selling } = useTill();
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  const location = useLocation();
  const navigate = useNavigate();
  const title = pageTitles[location.pathname] ?? brandName;
  const visibleNavItems = navItems.filter((item) => {
    if (!item.access) return true;
    return item.access === "admin" ? isAdmin : can(item.access);
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const sync = () => setFullscreen(isFullscreen());
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function switchFullscreen() {
    await toggleFullscreen();
    setFullscreen(isFullscreen());
  }

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
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:static lg:translate-x-0 ${
          collapsed ? "w-72 lg:w-[76px]" : "w-72"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div
          className={`flex items-center gap-3 py-5 ${
            collapsed ? "px-6 lg:justify-center lg:px-3" : "px-6"
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-100">
            <img
              src={logoSrc}
              alt={brandName}
              className="h-11 w-11 object-contain"
            />
          </div>
          <div
            className={`min-w-0 leading-tight ${collapsed ? "lg:hidden" : ""}`}
          >
            <p className="truncate text-sm font-extrabold uppercase tracking-tight text-brand-700">
              {brandName}
            </p>
            <p className="text-[11px] font-semibold tracking-widest text-slate-500">
              VENTE &amp; STOCK
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
          {/* Buttons, not links: an <a href> would make the browser print the
              target address in the status bar while hovering. */}
          {visibleNavItems.map((item) => {
            const isActive = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const feature = PLAN_FEATURE[item.access];
            const planLocked = Boolean(feature) && !hasFeature(feature);
            // Nothing is sold — nor even browsed — before the till is opened.
            const tillLocked = TILL_GATED.has(item.access) && !selling;
            const locked = planLocked || tillLocked;
            return (
              <button
                key={item.to}
                type="button"
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                title={
                  tillLocked
                    ? "🔒 Ouvrez votre caisse pour accéder à cette page"
                    : planLocked
                      ? `🔒 ${featureName(feature)} n'est pas incluse dans votre formule`
                      : undefined
                }
                onClick={() => {
                  setMobileOpen(false);
                  if (tillLocked) navigate("/caisse");
                  else navigate(planLocked ? "/mon-abonnement" : item.to);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                  collapsed ? "lg:justify-center lg:px-2" : ""
                } ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <item.icon size={20} className="shrink-0" />
                <span
                  className={`${collapsed ? "lg:hidden" : ""} ${
                    locked ? "text-slate-400" : ""
                  }`}
                >
                  {item.label}
                </span>
                {locked && (
                  <Lock
                    size={14}
                    className={`ml-auto shrink-0 text-slate-400 ${
                      collapsed ? "lg:hidden" : ""
                    }`}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div
            className={`flex items-center gap-3 rounded-xl px-2 py-2 ${
              collapsed ? "lg:flex-col lg:gap-2 lg:px-0" : ""
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {initials}
            </div>
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
              <p className="truncate text-sm font-semibold text-slate-900">
                {user?.name ?? "Administrateur"}
              </p>
              <p className="truncate text-xs text-slate-500">
                {roleLabels[user?.role ?? "admin"] ?? user?.role}
              </p>
            </div>
            <button
              onClick={logout}
              aria-label="Se déconnecter"
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
          <button
            className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:block"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
          >
            {collapsed ? (
              <PanelLeftOpen size={22} />
            ) : (
              <PanelLeftClose size={22} />
            )}
          </button>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && <UndoRedo />}
            {isAdmin && <NotificationBell />}
            <button
              onClick={() => void switchFullscreen()}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label={
                fullscreen ? "Quitter le plein écran" : "Passer en plein écran"
              }
              title={
                fullscreen ? "Quitter le plein écran" : "Passer en plein écran"
              }
            >
              {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={18} />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </header>

        <UpdateBanner />
        <LicenseBanner />
        <NetworkBanner />

        <main
          className={`flex-1 overflow-y-auto ${
            // The POS uses the whole screen: no page padding around it.
            location.pathname === "/ventes/nouvelle" ? "p-0" : "p-5 lg:p-7"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
