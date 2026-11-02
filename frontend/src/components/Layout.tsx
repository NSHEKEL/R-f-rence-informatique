import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Home,
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
  HandCoins,
  ClipboardList,
  Wallet,
  Undo2,
  Plus,
  BarChart3,
  FileText,
  Info,
  LifeBuoy,
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
  Moon,
  Sun,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { useLicense } from "../context/LicenseContext";
import { useTheme } from "../context/ThemeContext";
import { TILL_GATED, useTill } from "../context/TillContext";
import { useNetwork } from "../context/NetworkContext";
import { ADMIN_FEATURE, PLAN_FEATURE } from "../lib/planFeatures";
import { isFullscreen, toggleFullscreen } from "../lib/fullscreen";
import LicenseBanner from "./LicenseBanner";
import NetworkBanner from "./NetworkBanner";
import UpdateBanner from "./UpdateBanner";
import NotificationBell from "./NotificationBell";
import GlobalSearch from "./GlobalSearch";
import UndoRedo from "./UndoRedo";
import TillGate from "./TillGate";
import api from "../api/client";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Wallet;
  end?: boolean;
  access: string;
};

type NavGroup = {
  label: string;
  icon: typeof Wallet;
  items: NavItem[];
};

/**
 * Right the entry needs; "admin" marks the pages the administrator never
 * shares (accounts, settings, access rights).
 */
const navItems: NavItem[] = [
  {
    to: "/",
    label: "Accueil",
    icon: Home,
    end: true,
    access: "",
  },
  {
    to: "/tableau-de-bord",
    label: "Tableau de bord",
    icon: LayoutDashboard,
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
    label: "Devis & proforma",
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
    to: "/paie",
    label: "Paie & salaires",
    icon: Wallet,
    access: "paie",
  },
  {
    to: "/dettes",
    label: "Dettes & créances",
    icon: HandCoins,
    access: "dettes",
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
    access: "admin",
  },
  {
    to: "/assistance",
    label: "Assistance et support",
    icon: LifeBuoy,
    access: "assistance",
  },
  { to: "/a-propos", label: "À propos de nous", icon: Info, access: "apropos" },
];

const byPath = new Map(navItems.map((item) => [item.to, item]));

// Sidebar icon chips reuse the quick-action tile palette.
const NAV_TINTS: Record<string, string> = {
  "/": "bg-sky-500",
  "/tableau-de-bord": "bg-indigo-500",
  "/caisse": "bg-emerald-600",
  "/ventes/nouvelle": "bg-blue-600",
  "/ventes": "bg-blue-500",
  "/commandes": "bg-orange-500",
  "/livraisons": "bg-emerald-500",
  "/retours": "bg-red-500",
  "/clients": "bg-orange-600",
  "/produits": "bg-cyan-600",
  "/inventaire": "bg-cyan-500",
  "/rapports": "bg-violet-500",
  "/proformas": "bg-violet-600",
  "/comptabilite": "bg-teal-600",
  "/paie": "bg-pink-500",
  "/dettes": "bg-rose-500",
  "/fournisseurs": "bg-amber-600",
  "/approvisionnements": "bg-amber-500",
  "/categories": "bg-fuchsia-500",
  "/utilisateurs": "bg-slate-500",
  "/droits": "bg-slate-600",
  "/parametres": "bg-slate-500",
  "/mon-abonnement": "bg-yellow-500",
  "/assistance": "bg-lime-600",
  "/a-propos": "bg-sky-400",
};

const GROUP_TINTS: Record<string, string> = {
  Ventes: "bg-blue-600",
  Stocks: "bg-cyan-600",
  "Achats & commandes": "bg-orange-500",
  "Clients & finances": "bg-pink-500",
  Pilotage: "bg-violet-500",
  Administration: "bg-slate-500",
};

function pick(...paths: string[]): NavItem[] {
  return paths
    .map((path) => byPath.get(path))
    .filter((item): item is NavItem => Boolean(item));
}

/** Daily work grouped like a full ERP menu; only real modules appear. */
const navGroups: NavGroup[] = [
  {
    label: "Ventes",
    icon: ShoppingCart,
    items: pick(
      "/ventes/nouvelle",
      "/ventes",
      "/proformas",
      "/livraisons",
      "/retours"
    ),
  },
  {
    label: "Stocks",
    icon: Package,
    items: pick("/produits", "/categories", "/inventaire"),
  },
  {
    label: "Achats & commandes",
    icon: ClipboardCheck,
    items: pick("/commandes", "/approvisionnements", "/fournisseurs"),
  },
  {
    label: "Clients & finances",
    icon: HandCoins,
    items: pick("/clients", "/dettes", "/comptabilite", "/paie"),
  },
  {
    label: "Pilotage",
    icon: BarChart3,
    items: pick("/rapports"),
  },
  {
    label: "Administration",
    icon: UserCog,
    items: pick(
      "/utilisateurs",
      "/droits",
      "/parametres",
      "/mon-abonnement",
      "/assistance",
      "/a-propos"
    ),
  },
];

const topLevel = pick("/", "/tableau-de-bord", "/caisse");
const GROUPS_KEY = "ri_sidebar_groups";

/** Pages the dashboard's « Récemment utilisés » strip offers back. */
export const RECENTS_KEY = "ri_recent_pages";

const COLLAPSED_KEY = "ri_sidebar_collapsed";

const roleLabels: Record<string, string> = {
  admin: "Administrateur",
  vendeur: "Vendeur",
  gestionnaire: "Gestionnaire de stock",
};

const pageTitles: Record<string, string> = {
  "/": "Accueil",
  "/tableau-de-bord": "Tableau de bord",
  "/caisse": "Ma caisse",
  "/ventes/nouvelle": "Nouvelle vente",
  "/retours": "Retours & avoirs",
  "/produits": "Produits & Stock",
  "/inventaire": "Inventaire",
  "/rapports": "Rapports",
  "/proformas": "Devis & factures proforma",
  "/comptabilite": "Comptabilité",
  "/paie": "Paie & bulletins de salaire",
  "/dettes": "Dettes & créances",
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
  const [uiScale, setUiScale] = useState(
    () => Number(localStorage.getItem("ri_ui_scale")) || 1
  );
  useEffect(() => {
    const onChange = () =>
      setUiScale(Number(localStorage.getItem("ri_ui_scale")) || 1);
    window.addEventListener("ri_ui_scale_change", onChange);
    return () => window.removeEventListener("ri_ui_scale_change", onChange);
  }, []);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1"
  );
  const { user, isAdmin, can, logout } = useAuth();
  const { brandName, logoSrc } = useCompany();
  const { hasFeature, featureName } = useLicense();
  const { selling, session: tillSession } = useTill();
  const { online } = useNetwork();
  const { theme, toggle: toggleTheme } = useTheme();
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    api
      .get<{ version?: string }>("/health")
      .then(({ data }) => setAppVersion(data.version ?? ""))
      .catch(() => {});
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const title = pageTitles[location.pathname] ?? brandName;
  const allowed = (item: NavItem) => {
    if (!item.access) return true;
    return item.access === "admin" ? isAdmin : can(item.access);
  };
  const visibleTopLevel = topLevel.filter(allowed);
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(allowed) }))
    .filter((group) => group.items.length > 0);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(GROUPS_KEY);
    if (!saved) return {};
    const parsed: unknown = JSON.parse(saved);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, boolean>)
      : {};
  });

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  // Every visited module is remembered for the dashboard's recent strip.
  useEffect(() => {
    const label = pageTitles[location.pathname];
    if (!label) return;
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(RECENTS_KEY) ?? "[]"
      );
      const list = Array.isArray(saved) ? (saved as { to: string }[]) : [];
      const next = [
        { to: location.pathname, label },
        ...list.filter((r) => r.to !== location.pathname),
      ].slice(0, 6);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* localStorage indisponible */
    }
  }, [location.pathname]);

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

  function renderItem(item: NavItem) {
    const isActive = item.end
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to);
    const feature = ADMIN_FEATURE[item.to] ?? PLAN_FEATURE[item.access];
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
            ? "bg-[#2563eb] text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white ${
            NAV_TINTS[item.to] ?? "bg-slate-500"
          }`}
        >
          <item.icon size={14} />
        </span>
        <span
          className={`${collapsed ? "lg:hidden" : ""} ${
            locked ? "text-slate-300" : ""
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
  }

  const initials = (user?.name ?? "AD")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden" style={{ zoom: uiScale }}>
      <TillGate />
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white text-slate-800 transition-all duration-200 lg:static lg:translate-x-0 ${
          collapsed ? "w-[208px] lg:w-[76px]" : "w-[208px]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div
          className={`flex items-center gap-3 py-5 ${
            collapsed ? "px-6 lg:justify-center lg:px-3" : "px-6"
          }`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95 ring-1 ring-white/30">
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
            <p className="text-[11px] font-semibold tracking-widest text-slate-400">
              Gestion Commerciale &amp; Stock
            </p>
          </div>
          <button
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(false)}
            title="Fermer le menu" aria-label="Fermer le menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav
          aria-label="Menu principal"
          className="flex-1 space-y-1 overflow-y-auto px-4 py-2"
        >
          {/* Buttons, not links: an <a href> would make the browser print the
              target address in the status bar while hovering. */}
          {visibleTopLevel.map(renderItem)}
          {visibleGroups.map((group) => {
            const active = group.items.some((item) =>
              item.end
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to)
            );
            const open = openGroups[group.label] ?? active;
            return (
              <div key={group.label}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenGroups((groups) => ({
                      ...groups,
                      [group.label]: !open,
                    }))
                  }
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                    collapsed ? "lg:justify-center lg:px-2" : ""
                  } ${
                    active
                      ? "bg-[#2563eb] text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white ${
                      GROUP_TINTS[group.label] ?? "bg-slate-500"
                    }`}
                  >
                    <group.icon size={14} />
                  </span>
                  <span className={collapsed ? "lg:hidden" : ""}>
                    {group.label}
                  </span>
                  <span className={`ml-auto ${collapsed ? "lg:hidden" : ""}`}>
                    {open ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </span>
                </button>
                {open && (
                  <div
                    className={`mt-1 space-y-1 border-l border-slate-300 pl-3 ${
                      collapsed ? "lg:border-0 lg:pl-0" : "ml-5"
                    }`}
                  >
                    {group.items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div
            className={`flex items-center gap-3 rounded-xl px-2 py-2 ${
              collapsed ? "lg:flex-col lg:gap-2 lg:px-0" : ""
            }`}
          >
            {user?.photo ? (
              <img
                src={user.photo}
                alt={user.name}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {initials}
              </div>
            )}
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
              <p className="truncate text-sm font-semibold text-slate-800">
                {user?.name ?? "Administrateur"}
              </p>
              <p className="truncate text-xs text-slate-400">
                {roleLabels[user?.role ?? "admin"] ?? user?.role}
              </p>
            </div>
            <button
              onClick={logout}
              title="Se déconnecter" aria-label="Se déconnecter"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500"
            >
              <LogOut size={18} />
            </button>
          </div>
          <div className={collapsed ? "lg:hidden" : ""}>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <img
                src={logoSrc}
                alt=""
                className="h-8 w-8 shrink-0 object-contain"
              />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-xs font-bold text-brand-700">
                  {brandName}
                </p>
                <p className="truncate text-[10px] italic text-slate-400">
                  Votre succès, notre priorité !
                </p>
              </div>
            </div>
            {appVersion && (
              <p className="mt-1.5 text-center text-[10px] text-slate-400">
                Version {appVersion}
              </p>
            )}
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="relative z-30 flex items-center gap-4 border-b border-slate-200 bg-white px-5 py-2 text-slate-700">
          <button
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            title="Ouvrir le menu" aria-label="Ouvrir le menu"
          >
            <Menu size={22} />
          </button>
          <button
            className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:block"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Déplier le menu" : "Replier le menu"}
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
          >
            {collapsed ? (
              <PanelLeftOpen size={22} />
            ) : (
              <PanelLeftClose size={22} />
            )}
          </button>
          <h1 className="hidden text-xl font-bold text-slate-800 md:block">
            {title}
          </h1>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs font-medium capitalize text-slate-400 xl:block">
              {new Date().toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              title={theme === "dark" ? "Thème clair" : "Thème sombre"}
              aria-label={theme === "dark" ? "Thème clair" : "Thème sombre"}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {isAdmin && <UndoRedo />}
            {isAdmin && <NotificationBell />}
            <button
              onClick={() => void switchFullscreen()}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              aria-label={
                fullscreen ? "Quitter le plein écran" : "Passer en plein écran"
              }
              title={
                fullscreen ? "Quitter le plein écran" : "Passer en plein écran"
              }
            >
              {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
            <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-4 lg:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 ring-1 ring-brand-200">
                {initials}
              </span>
              <span className="hidden leading-tight xl:block">
                <span className="block max-w-[140px] truncate text-sm font-semibold text-slate-800">
                  {user?.name ?? "Administrateur"}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {roleLabels[user?.role ?? "admin"] ?? user?.role}
                </span>
              </span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-red-500"
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
          id="contenu"
          className={`flex-1 overflow-y-auto ${
            // The POS uses the whole screen: no page padding around it.
            location.pathname === "/ventes/nouvelle" ? "p-0" : "p-5 lg:p-7"
          }`}
        >
          <Outlet />
        </main>

        {/* Barre d'etat basse : caisse, vendeur, connectivite */}
        <footer className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-5 py-1.5 text-[11px] font-medium text-slate-500">
          <span>
            Caisse : {tillSession ? "Ouverte" : "—"}
          </span>
          <span className="hidden sm:inline">
            Vendeur : {user?.name ?? "—"}
          </span>
          <span className="ml-auto flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  online ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              {online ? "Connecté" : "Hors ligne"}
            </span>
            <span className="hidden sm:inline">
              Imprimante : {navigator.onLine ? "Prête" : "Hors ligne"}
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}
