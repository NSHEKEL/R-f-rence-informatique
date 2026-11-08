import { useState } from "react";
import { canOpenTreasury } from "../lib/treasury";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Package,
  PackagePlus,
  PackageCheck,
  ShoppingCart,
  Users,
  UserPlus,
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
import { useAuth } from "../context/AuthContext";
import { useLicense } from "../context/LicenseContext";
import { TILL_GATED, useTill } from "../context/TillContext";
import { ADMIN_FEATURE, PLAN_FEATURE } from "../lib/planFeatures";
import { RECENTS_KEY } from "../components/Layout";

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

export default function Accueil() {
  const { hasFeature } = useLicense();
  const { user, isAdmin, can } = useAuth();
  const { selling } = useTill();
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

  function tileAccess(tile: Tile): { ok: boolean; locked: "till" | "plan" | null } {
    const allowed =
      tile.access === "admin" ? isAdmin : !tile.access || can(tile.access);
    if (!allowed || !canOpenTreasury(tile.to, can)) return { ok: false, locked: null };
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

  return (
    <div className="space-y-6">
      {/* Welcome hero. */}
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

      {/* Quick actions as coloured tiles. */}
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
    </div>
  );
}
